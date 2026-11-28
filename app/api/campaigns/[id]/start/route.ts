import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import Contact from "@/lib/models/contact";
import MessageTemplate from "@/lib/models/message-template";
import { getStoredConnection, getEffectiveCredentials, markConnectionError } from "@/lib/whatsapp/config";
import { MetaApiError } from "@/lib/whatsapp/meta";
import { enqueueRecipients, verifyQueueInfrastructure } from "@/lib/campaigns/queue";
import { extractComponentTemplateVariables, listMetaTemplates, supportedTemplateComponents } from "@/lib/campaigns/meta-templates";
import { createCampaignRecipientSnapshot } from "@/lib/campaigns/snapshot";
import { canStartCampaign } from "@/lib/campaigns/dispatch-policy";

type RouteContext = { params: { id: string } };

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).confirm !== true) {
    return NextResponse.json({ error: { code: "CONFIRMATION_REQUIRED", message: "Explicit campaign confirmation is required." } }, { status: 400 });
  }
  if (!process.env.REDIS_URL?.trim()) {
    return NextResponse.json({ error: { code: "REDIS_NOT_CONFIGURED", message: "Configure REDIS_URL and the persistent campaign worker before starting a campaign." } }, { status: 503 });
  }

  let startClaimToken = "";
  try {
    await connectToDatabase();
    const campaign = await Campaign.findById(params.id);
    if (!campaign) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
    if (!canStartCampaign(campaign.status)) {
      return NextResponse.json({ error: { code: "CAMPAIGN_ALREADY_STARTED", message: "This campaign is no longer a draft and cannot be started again." } }, { status: 409 });
    }
    const isPersonalizedImport = Boolean(campaign.importBatchId);
    if (campaign.messageMode === "personalized_csv") {
      return NextResponse.json({ error: { code: "APPROVED_TEMPLATE_REQUIRED", message: "Free-form CSV campaigns are disabled. Create a new campaign with an approved Meta template." } }, { status: 409 });
    }
    if (!campaign.categoryIds.length || campaign.categoryIds.length !== 1 || !campaign.templateId) {
      return NextResponse.json({ error: { code: "CAMPAIGN_INCOMPLETE", message: "Select exactly one category and an approved template before starting." } }, { status: 400 });
    }
    const connection = await getStoredConnection();
    if (!connection || connection.status !== "connected") {
      return NextResponse.json({ error: { code: "NOT_CONNECTED", message: "Verify the WhatsApp connection before starting a campaign." } }, { status: 409 });
    }
    if (isPersonalizedImport) {
      const queuedRecipients = await CampaignRecipient.find({ campaignId: campaign._id, queueStatus: "queued" })
        .select("contactId")
        .lean();
      if (!queuedRecipients.length) {
        return NextResponse.json({ error: { code: "NO_ELIGIBLE_RECIPIENTS", message: "No reviewed recipients are eligible to enter the queue." } }, { status: 400 });
      }
      const contactIds = queuedRecipients.flatMap((recipient) => recipient.contactId ? [recipient.contactId] : []);
      const consentEligible = contactIds.length ? await Contact.exists({
        _id: { $in: contactIds },
        marketingConsentStatus: "Opted In",
        consentSource: { $ne: "" },
        consentTimestamp: { $type: "date", $lte: new Date() },
        doNotContact: { $ne: true }
      }) : null;
      if (!consentEligible) {
        return NextResponse.json({
          error: {
            code: "NO_ELIGIBLE_RECIPIENTS",
            message: "No recipient has current documented marketing opt-in. Record consent in Contacts before starting this campaign."
          }
        }, { status: 400 });
      }
    }
    let snapshotCounts: { total: number; eligible: number; excluded: number } | null = null;
    {
      const template = await MessageTemplate.findById(campaign.templateId);
      if (!template || template.isDraft || !template.metaTemplateId) {
        return NextResponse.json({ error: { code: "TEMPLATE_NOT_APPROVED", message: "Selected template has not been submitted to Meta." } }, { status: 400 });
      }
      if (!template.businessCategoryId || String(template.businessCategoryId) !== String(campaign.categoryIds[0])) {
        return NextResponse.json({
          error: {
            code: "TEMPLATE_CATEGORY_MISMATCH",
            message: "The selected template is not assigned to this campaign's business category. Choose the category-specific approved template."
          }
        }, { status: 400 });
      }
      const { credentials } = await getEffectiveCredentials();
      const remoteTemplates = await listMetaTemplates(credentials, credentials.wabaId);
      const remote = remoteTemplates.find((item) =>
        item.id === template.metaTemplateId &&
        item.name === template.name &&
        item.language === template.language
      );
      if (!remote || typeof remote.status !== "string" || remote.status.toUpperCase() !== "APPROVED") {
        if (remote && typeof remote.status === "string") {
          template.metaStatus = remote.status;
          template.lastSyncedAt = new Date();
          await template.save();
        }
        return NextResponse.json({ error: { code: "TEMPLATE_NOT_APPROVED", message: "Meta does not currently report this template as approved. Refresh its status and choose an approved template." } }, { status: 409 });
      }
      const remoteCategory = typeof remote.category === "string" ? remote.category.toUpperCase() : "";
      if (remoteCategory !== "MARKETING") {
        return NextResponse.json({
          error: {
            code: "MARKETING_TEMPLATE_REQUIRED",
            message: "Bulk promotional campaigns require an approved Marketing template. Utility confirmation templates cannot be used."
          }
        }, { status: 400 });
      }
      const components = supportedTemplateComponents(remote.components);
      if (!components) {
        return NextResponse.json({ error: { code: "TEMPLATE_NOT_ELIGIBLE", message: "Selected Meta template uses unsupported message components and cannot be sent by this campaign tool." } }, { status: 400 });
      }
      const variables = extractComponentTemplateVariables(components);
      if (variables.some((number, index) => number !== index + 1)) {
        return NextResponse.json({ error: { code: "TEMPLATE_VARIABLES_INVALID", message: "Meta template variables must be numbered consecutively from {{1}}." } }, { status: 400 });
      }
      if (!isPersonalizedImport && variables.some((number) => !campaign.variableMappings.some((mapping) => mapping.number === number))) {
        return NextResponse.json({ error: { code: "VARIABLE_MAPPING_REQUIRED", message: "Map every variable in the approved template before starting." } }, { status: 400 });
      }

      template.metaStatus = remote.status;
      template.metaCategory = remoteCategory;
      template.body = components.body;
      template.header = components.header;
      template.headerFormat = components.headerFormat;
      template.headerMediaUrl = components.headerMediaUrl;
      template.footer = components.footer;
      template.set("buttons", components.buttons);
      template.variables = variables;
      template.lastSyncedAt = new Date();
      await template.save();
      campaign.templateName = template.name;
      campaign.templateLanguage = template.language;
      campaign.templateCategory = template.metaCategory;
      campaign.templateBody = template.body;
      campaign.templateHeader = template.header;
      campaign.templateHeaderFormat = components.headerFormat;
      campaign.templateHeaderMediaUrl = components.headerMediaUrl;
      campaign.templateFooter = template.footer;
      campaign.templateButtons = components.buttons;
      await campaign.save();

      if (isPersonalizedImport) {
        await CampaignRecipient.updateMany(
          { campaignId: campaign._id, templateId: template._id },
          {
            $set: {
              templateName: template.name,
              templateLanguage: template.language,
              templateCategory: template.metaCategory
            }
          }
        );
      }

      try {
        await verifyQueueInfrastructure(true);
      } catch (error) {
        const workerUnavailable = error instanceof Error && error.message.includes("heartbeat");
        console.error(workerUnavailable ? "Campaign worker is unavailable." : "Redis connectivity check failed.", {
          error: error instanceof Error ? error.message : "Unknown queue error"
        });
        return NextResponse.json({
          error: {
            code: workerUnavailable ? "WORKER_UNAVAILABLE" : "REDIS_CONNECTION_FAILED",
            message: workerUnavailable
              ? "The persistent campaign worker is not running. Start or restore the worker before launching this campaign."
              : "Redis could not be reached. Check REDIS_URL, TLS, and the Redis service before launching this campaign."
          }
        }, { status: 503 });
      }

      startClaimToken = randomUUID();
      const startClaim = await Campaign.findOneAndUpdate(
        { _id: campaign._id, status: "Draft", startClaimToken: "" },
        { $set: { startClaimToken } },
        { new: true }
      ).select("_id").lean();
      if (!startClaim) {
        startClaimToken = "";
        return NextResponse.json({ error: { code: "CAMPAIGN_ALREADY_STARTED", message: "Another request is already starting this campaign." } }, { status: 409 });
      }

      if (!isPersonalizedImport) {
        snapshotCounts = await createCampaignRecipientSnapshot(campaign, template);
        if (!snapshotCounts.eligible) {
          await Campaign.updateOne(
            { _id: campaign._id, status: "Draft", startClaimToken },
            { $set: { startClaimToken: "" } }
          );
          startClaimToken = "";
          return NextResponse.json({
            error: { code: "NO_ELIGIBLE_RECIPIENTS", message: "No contacts have valid current consent and all required template values." }
          }, { status: 400 });
        }
      }
    }

    const started = await Campaign.findOneAndUpdate(
      { _id: campaign._id, status: "Draft", startClaimToken },
      {
        $set: {
          status: "Queued",
          startClaimToken: "",
          dispatchStatus: "completed",
          startedAt: new Date(),
          completedAt: null,
          queueConfirmedAt: null,
          errorCode: "",
          errorMessage: "",
          ...(isPersonalizedImport ? {} : {
            totalRecipients: snapshotCounts?.total ?? 0,
            eligibleRecipients: snapshotCounts?.eligible ?? 0,
            excludedRecipients: snapshotCounts?.excluded ?? 0,
            queuedCount: snapshotCounts?.eligible ?? 0,
            pausedCount: 0,
            processingCount: 0,
            acceptedCount: 0,
            sentCount: 0,
            deliveredCount: 0,
            readCount: 0,
            failedCount: 0
          })
        }
      },
      { new: true }
    ).lean();
    if (!started) {
      await Campaign.updateOne(
        { _id: campaign._id, status: "Draft", startClaimToken },
        { $set: { startClaimToken: "" } }
      );
      startClaimToken = "";
      return NextResponse.json({ error: { code: "CAMPAIGN_ALREADY_STARTED", message: "This campaign was already started." } }, { status: 409 });
    }
    startClaimToken = "";
    try {
      const recipients = await CampaignRecipient.find({ campaignId: started._id, queueStatus: "queued" })
        .select("_id queueVersion")
        .lean();
      await enqueueRecipients(recipients.map((recipient) => ({
        campaignId: String(started._id),
        recipientId: String(recipient._id),
        version: recipient.queueVersion
      })));
      await Campaign.updateOne(
        { _id: started._id, status: { $in: ["Queued", "Processing"] } },
        { $set: { queueConfirmedAt: new Date(), errorCode: "", errorMessage: "" } }
      );
    } catch (error) {
      if (startClaimToken) {
        await Campaign.updateOne(
          { _id: params.id, status: "Draft", startClaimToken },
          { $set: { startClaimToken: "" } }
        );
      }
      console.error("Campaign dispatch could not be confirmed in Redis.", error);
      await Campaign.updateOne(
        { _id: started._id },
        {
          $set: {
            errorCode: "QUEUE_DISPATCH_FAILED",
            errorMessage: "Recipient snapshots are safe, but Redis did not confirm their queue jobs. Restore the worker; do not start this campaign again."
          }
        }
      );
      return NextResponse.json({
        error: {
          code: "QUEUE_UNAVAILABLE",
          message: "Campaign is saved as queued but Redis did not confirm the dispatch job. Do not start it again; restore Redis and the worker to recover it."
        },
        campaignId: String(started._id)
      }, { status: 503 });
    }
    return NextResponse.json({ campaignId: String(started._id), status: "Queued" }, { status: 202 });
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)) {
        await markConnectionError(error.message);
      }
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    console.error("Campaign could not be started.", error);
    return NextResponse.json({ error: { code: "CAMPAIGN_START_FAILED", message: "Campaign could not be started." } }, { status: 500 });
  }
}
