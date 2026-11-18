import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Campaign from "@/lib/models/campaign";
import MessageTemplate from "@/lib/models/message-template";
import { extractTemplateVariables } from "@/lib/templates/validation";
import { getStoredConnection, getEffectiveCredentials, markConnectionError } from "@/lib/whatsapp/config";
import { MetaApiError } from "@/lib/whatsapp/meta";
import { enqueueCampaignDispatch } from "@/lib/campaigns/queue";
import { listMetaTemplates, supportedTemplateComponents } from "@/lib/campaigns/meta-templates";

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

  try {
    await connectToDatabase();
    const campaign = await Campaign.findById(params.id);
    if (!campaign) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
    if (campaign.status !== "Draft") {
      return NextResponse.json({ error: { code: "CAMPAIGN_ALREADY_STARTED", message: "This campaign is no longer a draft and cannot be started again." } }, { status: 409 });
    }
    const isPersonalizedImport = Boolean(campaign.importBatchId);
    const isFreeFormCsv = isPersonalizedImport && campaign.messageMode === "personalized_csv";
    if (!isPersonalizedImport && (!campaign.categoryIds.length || !campaign.templateId)) {
      return NextResponse.json({ error: { code: "CAMPAIGN_INCOMPLETE", message: "Select at least one category and an approved template before starting." } }, { status: 400 });
    }
    const connection = await getStoredConnection();
    if (!connection || connection.status !== "connected") {
      return NextResponse.json({ error: { code: "NOT_CONNECTED", message: "Verify the WhatsApp connection before starting a campaign." } }, { status: 409 });
    }
    if (isPersonalizedImport) {
      const eligible = await import("@/lib/models/campaign-recipient").then(({ default: CampaignRecipient }) =>
        CampaignRecipient.countDocuments({ campaignId: campaign._id, queueStatus: "queued" })
      );
      if (!eligible) return NextResponse.json({ error: { code: "NO_ELIGIBLE_RECIPIENTS", message: "No reviewed recipients are eligible to enter the queue." } }, { status: 400 });
    }
    if (!isFreeFormCsv) {
      const template = await MessageTemplate.findById(campaign.templateId);
      if (!template || template.isDraft || !template.metaTemplateId) {
        return NextResponse.json({ error: { code: "TEMPLATE_NOT_APPROVED", message: "Selected template has not been submitted to Meta." } }, { status: 400 });
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
      const components = supportedTemplateComponents(remote.components);
      const unsupportedComponentVariables = components && [
        components.header,
        components.footer,
        ...components.buttons.map((button) => button.url ?? "")
      ].some((text) => /\{\{\s*\d+\s*\}\}/.test(text));
      if (!components || unsupportedComponentVariables) {
        return NextResponse.json({ error: { code: "TEMPLATE_NOT_ELIGIBLE", message: "Selected Meta template uses unsupported message components and cannot be sent by this campaign tool." } }, { status: 400 });
      }
      const variables = extractTemplateVariables(components.body);
      if (variables.some((number, index) => number !== index + 1)) {
        return NextResponse.json({ error: { code: "TEMPLATE_VARIABLES_INVALID", message: "Meta template variables must be numbered consecutively from {{1}}." } }, { status: 400 });
      }
      if (!isPersonalizedImport && variables.some((number) => !campaign.variableMappings.some((mapping) => mapping.number === number))) {
        return NextResponse.json({ error: { code: "VARIABLE_MAPPING_REQUIRED", message: "Map every variable in the approved template before starting." } }, { status: 400 });
      }

      template.metaStatus = remote.status;
      template.body = components.body;
      template.header = components.header;
      template.footer = components.footer;
      template.set("buttons", components.buttons);
      template.variables = variables;
      template.lastSyncedAt = new Date();
      await template.save();
    }

    const started = await Campaign.findOneAndUpdate(
      { _id: campaign._id, status: "Draft" },
      {
        $set: {
          status: "Queued",
          dispatchStatus: isPersonalizedImport ? "completed" : "pending",
          startedAt: new Date(),
          completedAt: null,
          ...(isPersonalizedImport ? {} : {
            totalRecipients: 0,
            eligibleRecipients: 0,
            excludedRecipients: 0,
            queuedCount: 0,
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
      return NextResponse.json({ error: { code: "CAMPAIGN_ALREADY_STARTED", message: "This campaign was already started." } }, { status: 409 });
    }
    try {
      if (isPersonalizedImport) {
        const recipients = await import("@/lib/models/campaign-recipient").then(({ default: CampaignRecipient }) =>
          CampaignRecipient.find({ campaignId: started._id, queueStatus: "queued" }).select("_id queueVersion").lean()
        );
        const { enqueueRecipients } = await import("@/lib/campaigns/queue");
        await enqueueRecipients(recipients.map((recipient) => ({ campaignId: String(started._id), recipientId: String(recipient._id), version: recipient.queueVersion })));
      } else {
        await enqueueCampaignDispatch(String(started._id), started.dispatchVersion);
      }
    } catch (error) {
      console.error("Campaign dispatch could not be confirmed in Redis.", error);
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
