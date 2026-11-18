import type { Job } from "bullmq";
import { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/mongodb";
import { scanAudience, type EligibleRecipient } from "@/lib/campaigns/audience";
import { refreshCampaignCounts } from "@/lib/campaigns/counts";
import { applyCampaignDeliveryStatus } from "@/lib/campaigns/delivery";
import { enqueueRecipients, enqueueCampaignDispatch } from "@/lib/campaigns/queue";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import Contact from "@/lib/models/contact";
import Conversation from "@/lib/models/conversation";
import MessageSuppression from "@/lib/models/message-suppression";
import MessageTemplate from "@/lib/models/message-template";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import { normalizePhoneNumber } from "@/lib/contacts/validation";
import { getEffectiveCredentials, getStoredConnection, markConnectionError } from "@/lib/whatsapp/config";
import { graphRequest, MetaApiError } from "@/lib/whatsapp/meta";
import { hasActiveCustomerServiceWindow } from "@/lib/campaigns/personalized";

type DispatchData = { campaignId: string };
type RecipientData = { campaignId: string; recipientId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recipientDocument(campaignId: string, recipient: EligibleRecipient) {
  return {
    campaignId: new Types.ObjectId(campaignId),
    contactId: recipient.contactId,
    phoneNumber: recipient.phoneNumber,
    businessName: recipient.businessName,
    contactPerson: recipient.contactPerson,
    categoryId: recipient.categoryId,
    categoryName: recipient.categoryName,
    city: recipient.city,
    templateVariables: recipient.templateVariables
  };
}

async function dispatchCampaign({ campaignId }: DispatchData) {
  await connectToDatabase();
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || !["Queued", "Processing"].includes(campaign.status)) return;
  const template = campaign.templateId ? await MessageTemplate.findById(campaign.templateId) : null;
  if (!template || template.isDraft || template.metaStatus !== "APPROVED") {
    await Campaign.updateOne(
      { _id: campaignId, status: { $in: ["Queued", "Processing"] } },
      { $set: { status: "Failed", dispatchStatus: "completed", completedAt: new Date() } }
    );
    return;
  }
  campaign.dispatchStatus = "processing";
  await campaign.save();
  const options = {
    categoryIds: campaign.categoryIds.map((id) => id.toString()),
    cities: campaign.cities,
    variableMappings: campaign.variableMappings.map((item) => ({
      number: item.number,
      mapping: item.mapping as "contactPerson" | "businessName" | "city"
    })),
    body: template.body
  };
  for await (const batch of scanAudience(options)) {
    const current = await Campaign.findById(campaignId).select("status").lean();
    if (!current || !["Queued", "Processing"].includes(current.status)) return;
    const operations = [
      ...batch.eligible.map((recipient) => ({
        updateOne: {
          filter: { campaignId: new Types.ObjectId(campaignId), contactId: recipient.contactId },
          update: { $setOnInsert: recipientDocument(campaignId, recipient) },
          upsert: true
        }
      })),
      ...batch.excluded.map((recipient) => ({
        updateOne: {
          filter: { campaignId: new Types.ObjectId(campaignId), contactId: recipient.contactId },
          update: {
            $setOnInsert: {
              campaignId: new Types.ObjectId(campaignId),
              contactId: recipient.contactId,
              phoneNumber: recipient.phoneNumber,
              businessName: recipient.businessName,
              contactPerson: recipient.contactPerson,
              categoryId: recipient.categoryId,
              categoryName: recipient.categoryName,
              city: recipient.city,
              queueStatus: "excluded" as const,
              errorCode: recipient.errorCode,
              errorMessage: recipient.errorMessage
            }
          },
          upsert: true
        }
      }))
    ];
    if (operations.length) await CampaignRecipient.bulkWrite(operations, { ordered: false });
    const ids = batch.eligible.map((recipient) => recipient.contactId);
    if (ids.length) {
      const saved = await CampaignRecipient.find({
        campaignId,
        contactId: { $in: ids },
        queueStatus: "queued"
      }).select("_id queueVersion").lean();
      await enqueueRecipients(saved.map((recipient) => ({
        campaignId,
        recipientId: String(recipient._id),
        version: recipient.queueVersion
      })));
    }
  }
  await Campaign.updateOne(
    { _id: campaignId, status: { $in: ["Queued", "Processing"] } },
    { $set: { dispatchStatus: "completed" } }
  );
  await refreshCampaignCounts(campaignId);
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
          eligibilityStatus: code === "TEMPLATE_REQUIRED" ? "Template Required" : code === "SUPPRESSED" ? "Suppressed" : "Missing Consent",
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

  const isFreeFormCsv = campaign.messageMode === "personalized_csv";
  const contact = recipient.contactId ? await Contact.findById(recipient.contactId)
    .select("phoneNumber marketingConsentStatus consentSource consentTimestamp")
    .lean() : null;
  const currentPhone = contact ? normalizePhoneNumber(contact.phoneNumber) : null;
  const timestamp = contact?.consentTimestamp;
  const consentValid = Boolean(
    contact &&
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

  const template = !isFreeFormCsv && campaign.templateId ? await MessageTemplate.findById(campaign.templateId).lean() : null;
  if (!isFreeFormCsv && (!template || template.isDraft || template.metaStatus !== "APPROVED" || !template.metaTemplateId)) {
    await failRecipient(recipientId, "TEMPLATE_NOT_APPROVED", "The selected template is no longer approved by Meta.");
    return;
  }
  if (isFreeFormCsv) {
    const conversation = await Conversation.findOne({ phoneNumber: recipient.phoneNumber }).select("lastIncomingMessageAt").lean();
    const lastIncoming = conversation?.lastIncomingMessageAt;
    if (!recipient.originalCsvMessage || !hasActiveCustomerServiceWindow(lastIncoming)) {
      await failRecipient(recipientId, "TEMPLATE_REQUIRED", "The 24-hour customer service window is closed; the exact CSV message was not converted or sent.", "excluded");
      return;
    }
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
    .select("phoneNumber marketingConsentStatus consentSource consentTimestamp")
    .lean() : null;
  const latestPhone = latestContact ? normalizePhoneNumber(latestContact.phoneNumber) : null;
  const latestSuppression = await MessageSuppression.exists({ phoneNumber: recipient.phoneNumber });
  const latestConsent = Boolean(
    latestContact &&
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
  if (!latestConsent || latestSuppression) {
    await failRecipient(recipientId, latestSuppression ? "SUPPRESSED" : "CONSENT_REVOKED", "Contact eligibility changed before sending.", "excluded");
    return;
  }
  if (isFreeFormCsv) {
    const latestConversation = await Conversation.findOne({ phoneNumber: recipient.phoneNumber }).select("lastIncomingMessageAt").lean();
    const lastIncoming = latestConversation?.lastIncomingMessageAt;
    if (!hasActiveCustomerServiceWindow(lastIncoming)) {
      await failRecipient(recipientId, "TEMPLATE_REQUIRED", "The 24-hour customer service window closed before sending; the exact CSV message was not sent.", "excluded");
      return;
    }
  }

  try {
    const { credentials } = await getEffectiveCredentials();
    const components: Record<string, unknown>[] = [];
    if (!isFreeFormCsv && recipient.templateVariables.length) {
      components.push({
        type: "body",
        parameters: recipient.templateVariables.map((text) => ({ type: "text", text }))
      });
    }
    const requestBody = isFreeFormCsv ? {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient.phoneNumber.replace(/^\+/, ""),
      type: "text",
      text: { preview_url: false, body: recipient.originalCsvMessage }
    } : {
      messaging_product: "whatsapp",
      to: recipient.phoneNumber.replace(/^\+/, ""),
      type: "template",
      template: {
        name: template!.name,
        language: { code: template!.language },
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
    const renderedBody = isFreeFormCsv ? recipient.originalCsvMessage : template!.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) =>
      recipient.templateVariables[Number(number) - 1] ?? ""
    );
    const finalRenderedMessage = isFreeFormCsv ? renderedBody : [template!.header, renderedBody, template!.footer].filter(Boolean).join("\n\n");
    await WhatsAppMessage.updateOne(
      { messageId },
      {
        $set: {
          campaignId: campaign._id,
          campaignRecipientId: recipient._id,
          whatsappContactId: recipient.phoneNumber.replace(/^\+/, ""),
          phoneNumber: recipient.phoneNumber,
          contactName: recipient.contactPerson,
          messageType: isFreeFormCsv ? "text" : "template",
          content: finalRenderedMessage,
          metadata: isFreeFormCsv ? { source: "personalized_csv" } : { templateName: template!.name, templateLanguage: template!.language },
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
  const campaigns = await Campaign.find({
    status: { $in: ["Queued", "Processing"] },
    dispatchStatus: { $in: ["pending", "processing"] }
  }).select("_id dispatchVersion").lean();
  for (const campaign of campaigns) {
    await enqueueCampaignDispatch(String(campaign._id), campaign.dispatchVersion);
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
  if (job.name === "dispatch-campaign") return dispatchCampaign(job.data as DispatchData);
  if (job.name === "send-recipient") return sendRecipient(job.data as RecipientData, job);
  throw new Error(`Unknown campaign job: ${job.name}`);
}

export async function enqueueResumeWork(campaignId: string) {
  const campaign = await Campaign.findById(campaignId).select("dispatchStatus dispatchVersion").lean();
  if (!campaign) return;
  if (campaign.dispatchStatus !== "completed") {
    await enqueueCampaignDispatch(campaignId, campaign.dispatchVersion);
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

