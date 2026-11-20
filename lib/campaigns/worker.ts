import type { Job } from "bullmq";
import { connectToDatabase } from "@/lib/db/mongodb";
import { refreshCampaignCounts } from "@/lib/campaigns/counts";
import { applyCampaignDeliveryStatus } from "@/lib/campaigns/delivery";
import { canDispatchRecipient } from "@/lib/campaigns/dispatch-policy";
import { enqueueRecipients } from "@/lib/campaigns/queue";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import Contact from "@/lib/models/contact";
import MessageSuppression from "@/lib/models/message-suppression";
import MessageTemplate from "@/lib/models/message-template";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import CampaignRecipientReservation from "@/lib/models/campaign-recipient-reservation";
import { normalizePhoneNumber } from "@/lib/contacts/validation";
import { getEffectiveCredentials, getStoredConnection, markConnectionError } from "@/lib/whatsapp/config";
import { graphRequest, MetaApiError } from "@/lib/whatsapp/meta";
import { extractComponentTemplateVariables } from "@/lib/campaigns/meta-templates";
import { buildTemplateSendComponents } from "@/lib/campaigns/template-components";

type DispatchData = { campaignId: string };
type RecipientData = { campaignId: string; recipientId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function quarantineLegacyDispatch({ campaignId }: DispatchData) {
  await connectToDatabase();
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign || !["Queued", "Processing"].includes(campaign.status)) return;
  const [recipientCount, messageCount] = await Promise.all([
    CampaignRecipient.countDocuments({ campaignId }),
    WhatsAppMessage.countDocuments({ campaignId })
  ]);
  if (!recipientCount && !messageCount) {
    await Campaign.updateOne(
      { _id: campaignId, status: { $in: ["Queued", "Processing"] }, dispatchStatus: { $ne: "completed" } },
      {
        $set: {
          status: "Failed",
          dispatchStatus: "failed",
          errorCode: "RECIPIENT_SNAPSHOT_MISSING",
          errorMessage: "This legacy campaign had no durable recipient snapshot and was not sent. Create a new campaign with the correct Marketing template.",
          completedAt: new Date()
        }
      }
    );
    console.error("Legacy campaign quarantined because its recipient snapshot was missing.", { campaignId });
  }
}

async function failRecipient(recipientId: string, code: string, message: string, queueStatus = "failed") {
  const recipient = await CampaignRecipient.findOneAndUpdate(
    { _id: recipientId, queueStatus: { $in: ["queued", "processing"] } },
    {
      $set: {
        queueStatus,
        deliveryStatus: queueStatus === "uncertain" ? "uncertain" : queueStatus === "failed" ? "failed" : "pending",
        errorCode: code,
        errorMessage: message.slice(0, 1000),
        ...(queueStatus === "excluded" ? {
          eligibilityStatus: code === "TEMPLATE_REQUIRED"
            ? "Template Required"
            : code === "SUPPRESSED"
              ? "Suppressed"
              : code === "DUPLICATE_PHONE"
                ? "Duplicate Contact"
                : code === "WRONG_CATEGORY"
                  ? "Wrong Category"
                  : code === "MISSING_TEMPLATE_VARIABLE"
                    ? "Missing Variable"
                    : code === "APPROVED_TEMPLATE_REQUIRED"
                      ? "Excluded"
                      : code === "TEMPLATE_NOT_APPROVED"
                        ? "Excluded"
                    : "Missing Consent",
          exclusionReason: message.slice(0, 1000)
        } : {}),
        updatedStatusAt: new Date()
      }
    },
    { new: true }
  ).lean();
  if (recipient) await refreshCampaignCounts(recipient.campaignId.toString());
}

async function sendRecipient({ campaignId, recipientId }: RecipientData, job: Job) {
  await connectToDatabase();
  const campaign = await Campaign.findById(campaignId);
  const recipient = await CampaignRecipient.findById(recipientId);
  if (!campaign || !recipient) return;
  if (recipient.queueStatus === "processing") {
    await failRecipient(recipientId, "SEND_RESULT_UNCERTAIN", "A prior worker attempt stopped after starting the Meta request; the message was not retried.", "uncertain");
    return;
  }
  if (recipient.queueStatus !== "queued") return;
  if (campaign.status === "Paused") {
    await failRecipient(recipientId, "", "", "paused");
    return;
  }
  if (campaign.status === "Cancelled" || campaign.status === "Completed" || campaign.status === "Failed") {
    await failRecipient(recipientId, "CAMPAIGN_INACTIVE", "Campaign is no longer active.", "cancelled");
    return;
  }
  if (!["Queued", "Processing"].includes(campaign.status)) return;

  if (campaign.messageMode === "personalized_csv") {
    await failRecipient(recipientId, "APPROVED_TEMPLATE_REQUIRED", "Free-form CSV messages are disabled for bulk campaigns.", "excluded");
    return;
  }
  const reservation = await CampaignRecipientReservation.exists({
    phoneNumber: recipient.phoneNumber,
    campaignId: campaign._id,
    campaignRecipientId: recipient._id
  });
  if (!canDispatchRecipient(recipient.queueStatus, Boolean(reservation))) {
    await failRecipient(recipientId, "DUPLICATE_PHONE", "Recipient has no campaign-owned atomic reservation.", "excluded");
    return;
  }
  const contact = recipient.contactId ? await Contact.findById(recipient.contactId)
    .select("phoneNumber categoryId marketingConsentStatus consentSource consentTimestamp doNotContact")
    .lean() : null;
  const currentPhone = contact ? normalizePhoneNumber(contact.phoneNumber) : null;
  const categoryMatches = Boolean(contact && campaign.categoryIds.some((categoryId) => categoryId.equals(contact.categoryId)));
  if (!categoryMatches) {
    await failRecipient(recipientId, "WRONG_CATEGORY", "Contact no longer belongs to the campaign's selected category.", "excluded");
    return;
  }
  const timestamp = contact?.consentTimestamp;
  const consentValid = Boolean(
    contact &&
    !contact.doNotContact &&
    contact.marketingConsentStatus === "Opted In" &&
    contact.consentSource?.trim() &&
    timestamp instanceof Date &&
    !Number.isNaN(timestamp.getTime()) &&
    timestamp.getTime() <= Date.now() &&
    currentPhone === recipient.phoneNumber
  );
  const isSuppressed = await MessageSuppression.exists({ phoneNumber: recipient.phoneNumber });
  if (!consentValid || isSuppressed) {
    await failRecipient(
      recipientId,
      isSuppressed ? "SUPPRESSED" : "CONSENT_REVOKED",
      isSuppressed ? "Contact is on the suppression list." : "Contact no longer has current documented consent.",
      "excluded"
    );
    return;
  }

  const template = campaign.templateId ? await MessageTemplate.findById(campaign.templateId).lean() : null;
  const liveTemplateValid = Boolean(
    template &&
    !template.isDraft &&
    template.metaStatus === "APPROVED" &&
    template.metaCategory === "MARKETING" &&
    template.metaTemplateId &&
    template.name === recipient.templateName &&
    template.language === recipient.templateLanguage &&
    recipient.templateCategory === "MARKETING"
  );
  if (!template || !liveTemplateValid) {
    await failRecipient(recipientId, "TEMPLATE_NOT_APPROVED", "The selected template is no longer approved by Meta.", "excluded");
    return;
  }
  const requiredVariables = extractComponentTemplateVariables(template);
  if (requiredVariables.some((number) => !recipient.templateVariables[number - 1]?.trim())) {
    await failRecipient(recipientId, "MISSING_TEMPLATE_VARIABLE", "One or more current template parameters are missing.", "excluded");
    return;
  }
  const storedConnection = await getStoredConnection();
  if (!storedConnection || storedConnection.status !== "connected") {
    await failRecipient(recipientId, "NOT_CONNECTED", "WhatsApp connection is not active.");
    return;
  }

  const claimed = await CampaignRecipient.updateOne(
    { _id: recipientId, queueStatus: "queued" },
    { $set: { queueStatus: "processing" }, $inc: { attemptCount: 1 } }
  );
  if (!claimed.modifiedCount) return;
  await Campaign.updateOne({ _id: campaignId, status: "Queued" }, { $set: { status: "Processing" } });
  await refreshCampaignCounts(campaignId);

  const beforeSend = await Campaign.findById(campaignId).select("status").lean();
  const latestContact = recipient.contactId ? await Contact.findById(recipient.contactId)
    .select("phoneNumber categoryId marketingConsentStatus consentSource consentTimestamp doNotContact")
    .lean() : null;
  const latestPhone = latestContact ? normalizePhoneNumber(latestContact.phoneNumber) : null;
  const latestSuppression = await MessageSuppression.exists({ phoneNumber: recipient.phoneNumber });
  const latestConsent = Boolean(
    latestContact &&
    !latestContact.doNotContact &&
    latestContact.marketingConsentStatus === "Opted In" &&
    latestContact.consentSource?.trim() &&
    latestContact.consentTimestamp instanceof Date &&
    latestContact.consentTimestamp.getTime() <= Date.now() &&
    latestPhone === recipient.phoneNumber
  );
  if (beforeSend?.status === "Paused") {
    await failRecipient(recipientId, "", "", "paused");
    return;
  }
  if (!beforeSend || beforeSend.status === "Cancelled") {
    await failRecipient(recipientId, "CAMPAIGN_CANCELLED", "Campaign was cancelled before this message was sent.", "cancelled");
    return;
  }
  const latestCategoryMatches = Boolean(
    latestContact && campaign.categoryIds.some((categoryId) => categoryId.equals(latestContact.categoryId))
  );
  if (!latestCategoryMatches) {
    await failRecipient(recipientId, "WRONG_CATEGORY", "Contact no longer belongs to the campaign's selected category.", "excluded");
    return;
  }
  if (!latestConsent || latestSuppression) {
    await failRecipient(recipientId, latestSuppression ? "SUPPRESSED" : "CONSENT_REVOKED", "Contact eligibility changed before sending.", "excluded");
    return;
  }
  const currentReservation = await CampaignRecipientReservation.exists({
    phoneNumber: recipient.phoneNumber,
    campaignId: campaign._id,
    campaignRecipientId: recipient._id
  });
  if (!currentReservation) {
    await failRecipient(recipientId, "DUPLICATE_PHONE", "Recipient reservation changed before send.", "excluded");
    return;
  }

  try {
    const { credentials } = await getEffectiveCredentials();
    const components = buildTemplateSendComponents(template, recipient.templateVariables);
    const requestBody = {
      messaging_product: "whatsapp",
      to: recipient.phoneNumber.replace(/^\+/, ""),
      type: "template",
      template: {
        name: recipient.templateName || template!.name,
        language: { code: recipient.templateLanguage || template!.language },
        ...(components.length ? { components } : {})
      }
    };
    const result = await graphRequest<{ messages?: unknown }>(
      credentials,
      `${encodeURIComponent(credentials.phoneNumberId)}/messages`,
      {
        method: "POST",
        retrySafe: false,
        body: requestBody
      }
    );
    const first = Array.isArray(result.messages) ? result.messages[0] : null;
    const messageId = isRecord(first) && typeof first.id === "string" ? first.id : "";
    if (!messageId) {
      await failRecipient(recipientId, "META_UNCONFIRMED_RESPONSE", "Meta did not return a message ID. Delivery result is uncertain.", "uncertain");
      return;
    }
    const reported = isRecord(first) && typeof first.message_status === "string" ? first.message_status.toLowerCase() : "accepted";
    const deliveryStatus = ["accepted", "sent", "delivered", "read", "failed"].includes(reported) ? reported : "accepted";
    const rank = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 2 }[deliveryStatus as "accepted" | "sent" | "delivered" | "read" | "failed"];
    const errorCode = deliveryStatus === "failed" ? "META_MESSAGE_FAILED" : "";
    const renderedBody = recipient.renderedMessage || template!.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) =>
        recipient.templateVariables[Number(number) - 1] ?? ""
      );
    const buttonPreview = template!.buttons.map((button) =>
      `${button.text}${button.url ? ` · ${button.url.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) => recipient.templateVariables[Number(number) - 1] ?? "")}` : ""}`
    );
    const finalRenderedMessage = recipient.renderedMessage || [template!.header, renderedBody, template!.footer, ...buttonPreview].filter(Boolean).join("\n\n");
    await WhatsAppMessage.updateOne(
      { messageId },
      {
        $set: {
          campaignId: campaign._id,
          campaignRecipientId: recipient._id,
          whatsappContactId: recipient.phoneNumber.replace(/^\+/, ""),
          phoneNumber: recipient.phoneNumber,
          contactName: recipient.contactPerson,
          messageType: "template",
          content: finalRenderedMessage,
          metadata: {
            templateName: recipient.templateName || template!.name,
            templateLanguage: recipient.templateLanguage || template!.language
          },
          direction: "outgoing",
          contactId: recipient.contactId
        },
        $setOnInsert: {
          messageId,
          messageTimestamp: new Date(),
          status: deliveryStatus,
          statusRank: rank
        }
      },
      { upsert: true }
    );
    await CampaignRecipient.updateOne(
      { _id: recipientId, queueStatus: "processing" },
      {
        $set: {
          queueStatus: "accepted",
          deliveryStatus,
          deliveryRank: rank,
          whatsappMessageId: messageId,
          renderedMessage: finalRenderedMessage,
          sentTimestamp: new Date(),
          errorCode,
          errorMessage: deliveryStatus === "failed" ? "Meta reported this message as failed." : "",
          updatedStatusAt: new Date()
        }
      }
    );
    const possibleEarlyStatus = await WhatsAppMessage.findOne({ messageId }).select("status failureCode failureMessage").lean();
    if (possibleEarlyStatus && ["sent", "delivered", "read", "failed"].includes(possibleEarlyStatus.status)) {
      await applyCampaignDeliveryStatus(
        recipientId,
        possibleEarlyStatus.status,
        possibleEarlyStatus.failureCode,
        possibleEarlyStatus.failureMessage
      );
    }
    await refreshCampaignCounts(campaignId);
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)) {
        await markConnectionError(error.message);
      }
      if (["META_TIMEOUT", "META_NETWORK_ERROR", "META_UNCONFIRMED_RESPONSE"].includes(error.code)) {
        await failRecipient(recipientId, error.code, error.message, "uncertain");
        return;
      }
      const retryable = ["META_RATE_LIMIT", "META_UNAVAILABLE"].includes(error.code);
      if (retryable && job.attemptsMade < 4) {
        await CampaignRecipient.updateOne(
          { _id: recipientId, queueStatus: "processing" },
          { $set: { queueStatus: "queued", errorCode: error.code, errorMessage: error.message } }
        );
        throw error;
      }
      await failRecipient(recipientId, error.code, error.message);
      return;
    }
    if (job.attemptsMade < 4) {
      await CampaignRecipient.updateOne(
        { _id: recipientId, queueStatus: "processing" },
        { $set: { queueStatus: "queued", errorCode: "WORKER_RETRY", errorMessage: "Temporary worker processing error." } }
      );
      throw error;
    }
    await failRecipient(recipientId, "WORKER_FAILED", "Message processing could not be completed.");
  }
}

export async function recoverQueuedWork() {
  await connectToDatabase();
  const legacyCampaigns = await Campaign.find({
    status: { $in: ["Queued", "Processing"] },
    dispatchStatus: { $in: ["pending", "processing"] }
  }).select("_id").lean();
  for (const campaign of legacyCampaigns) {
    await quarantineLegacyDispatch({ campaignId: String(campaign._id) });
  }
  const activeCampaignIds = await Campaign.find({ status: { $in: ["Queued", "Processing"] } }).distinct("_id");
  if (!activeCampaignIds.length) return;
  const cursor = CampaignRecipient.find({ queueStatus: "queued", campaignId: { $in: activeCampaignIds } })
    .select("_id campaignId queueVersion")
    .sort({ createdAt: 1 })
    .lean()
    .cursor();
  let batch: { campaignId: string; recipientId: string; version: number }[] = [];
  for await (const recipient of cursor) {
    batch.push({
      campaignId: String(recipient.campaignId),
      recipientId: String(recipient._id),
      version: recipient.queueVersion
    });
    if (batch.length >= 250) {
      await enqueueRecipients(batch);
      batch = [];
    }
  }
  await enqueueRecipients(batch);
}

export async function processCampaignJob(job: Job) {
  if (job.name === "health-probe") return;
  if (job.name === "dispatch-campaign") return quarantineLegacyDispatch(job.data as DispatchData);
  if (job.name === "send-recipient") return sendRecipient(job.data as RecipientData, job);
  throw new Error(`Unknown campaign job: ${job.name}`);
}

export async function enqueueResumeWork(campaignId: string) {
  const campaign = await Campaign.findById(campaignId).select("dispatchStatus dispatchVersion").lean();
  if (!campaign) return;
  if (campaign.dispatchStatus !== "completed") {
    await quarantineLegacyDispatch({ campaignId });
    return;
  }
  const paused = await CampaignRecipient.find({ campaignId, queueStatus: "paused" }).select("_id queueVersion").lean();
  const entries = paused.map((item) => ({
    campaignId,
    recipientId: String(item._id),
    version: item.queueVersion + 1
  }));
  if (entries.length) {
    await CampaignRecipient.updateMany(
      { _id: { $in: paused.map((item) => item._id) }, queueStatus: "paused" },
      { $set: { queueStatus: "queued" }, $inc: { queueVersion: 1 } }
    );
    await enqueueRecipients(entries);
  }
}

