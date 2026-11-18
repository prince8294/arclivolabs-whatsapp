import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { rateLimit } from "@/lib/api/rate-limit";
import { connectToDatabase } from "@/lib/db/mongodb";
import { extractTemplateVariables } from "@/lib/templates/validation";
import { updateConversationActivity } from "@/lib/inbox/conversations";
import Conversation from "@/lib/models/conversation";
import Contact from "@/lib/models/contact";
import InboxSendAttempt from "@/lib/models/inbox-send-attempt";
import MessageTemplate from "@/lib/models/message-template";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import { normalizePhoneNumber } from "@/lib/contacts/validation";
import { getEffectiveCredentials, getStoredConnection, markConnectionError } from "@/lib/whatsapp/config";
import { graphRequest, MetaApiError } from "@/lib/whatsapp/meta";
import { listMetaTemplates, supportedTemplateComponents } from "@/lib/campaigns/meta-templates";

type RouteContext = { params: { id: string } };
type SendPlan = {
  type: "text" | "template";
  text: string;
  templateName?: string;
  templateLanguage?: string;
  components?: Record<string, unknown>[];
  metadata: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isReplyWindowOpen(lastIncomingMessageAt: Date | null | undefined) {
  if (!lastIncomingMessageAt) return false;
  const age = Date.now() - lastIncomingMessageAt.getTime();
  return age >= 0 && age < 24 * 60 * 60 * 1000;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) return errorResponse("FORBIDDEN", "Request origin is not allowed.", 403);
  if (!isAdminSessionValid(request)) return errorResponse("UNAUTHORIZED", "Admin sign-in is required.", 401);
  const limited = rateLimit(request, "inbox-manual-send", 15);
  if (limited) return limited;
  if (!Types.ObjectId.isValid(params.id)) return errorResponse("NOT_FOUND", "Conversation was not found.", 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
  if (!isRecord(body)) return errorResponse("INVALID_MESSAGE", "Message details are invalid.", 400);
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return errorResponse("INVALID_REQUEST_ID", "A valid message request ID is required.", 400);
  }
  const type = body.type === "template" ? "template" : body.type === "text" || body.type === undefined ? "text" : null;
  if (!type) return errorResponse("INVALID_MESSAGE_TYPE", "Choose a text reply or an approved template.", 400);

  let plan: SendPlan;
  try {
    await connectToDatabase();
    const prior = await InboxSendAttempt.findOne({ requestId }).lean();
    if (prior) {
      if (prior.status === "accepted" && prior.messageId) {
        return NextResponse.json({ messageId: prior.messageId, status: "accepted", duplicate: true });
      }
      return errorResponse(
        "REQUEST_ALREADY_ATTEMPTED",
        prior.status === "uncertain"
          ? "The send result is uncertain. Check the conversation before sending again."
          : "This message request was already attempted and will not be sent again.",
        409
      );
    }
    const conversation = await Conversation.findById(params.id).lean();
    if (!conversation) return errorResponse("NOT_FOUND", "Conversation was not found.", 404);
    const phoneNumber = normalizePhoneNumber(conversation.phoneNumber);
    if (!phoneNumber) return errorResponse("INVALID_WHATSAPP_NUMBER", "This conversation does not have a valid WhatsApp number.", 400);

    if (type === "text") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text || text.length > 4096) {
        return errorResponse("INVALID_MESSAGE", "Text replies must contain 1–4,096 characters.", 400);
      }
      if (!isReplyWindowOpen(conversation.lastIncomingMessageAt)) {
        return errorResponse("REPLY_WINDOW_CLOSED", "24-hour reply window closed. Select an approved template to continue.", 409);
      }
      plan = { type, text, metadata: {} };
    } else {
      if (typeof body.templateId !== "string" || !Types.ObjectId.isValid(body.templateId)) {
        return errorResponse("INVALID_TEMPLATE", "Choose a saved WhatsApp template.", 400);
      }
      const template = await MessageTemplate.findById(body.templateId).lean();
      if (!template || template.isDraft || template.metaStatus !== "APPROVED" || !template.metaTemplateId) {
        return errorResponse("TEMPLATE_NOT_APPROVED", "Choose a template that Meta currently reports as approved.", 400);
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
          await MessageTemplate.updateOne({ _id: template._id }, { $set: { metaStatus: remote.status, lastSyncedAt: new Date() } });
        }
        return errorResponse("TEMPLATE_NOT_APPROVED", "Meta does not currently report this template as approved.", 409);
      }
      const components = supportedTemplateComponents(remote.components);
      const unsupportedVariables = components && [
        components.header,
        components.footer,
        ...components.buttons.map((button) => button.url ?? "")
      ].some((value) => /\{\{\s*\d+\s*\}\}/.test(value));
      if (!components || unsupportedVariables) {
        return errorResponse("TEMPLATE_NOT_ELIGIBLE", "This template uses components not supported by manual inbox sending.", 400);
      }
      const variableNumbers = extractTemplateVariables(components.body);
      if (variableNumbers.some((number, index) => number !== index + 1)) {
        return errorResponse("TEMPLATE_VARIABLES_INVALID", "Template variables must be numbered consecutively from {{1}}.", 400);
      }
      if (!Array.isArray(body.variables) || body.variables.length !== variableNumbers.length ||
        body.variables.some((value) => typeof value !== "string" || !value.trim() || value.length > 1000)) {
        return errorResponse("TEMPLATE_VARIABLES_REQUIRED", "Provide a value for every variable in the approved template.", 400);
      }
      const variables = body.variables as string[];
      const renderedBody = components.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) => variables[Number(number) - 1]);
      const text = [components.header, renderedBody, components.footer].filter(Boolean).join("\n\n");
      const messageComponents = variableNumbers.length
        ? [{ type: "body", parameters: variables.map((value) => ({ type: "text", text: value.trim() })) }]
        : [];
      plan = {
        type,
        text,
        templateName: template.name,
        templateLanguage: template.language,
        components: messageComponents,
        metadata: { templateName: template.name, templateLanguage: template.language, buttons: components.buttons }
      };
    }

    const connection = await getStoredConnection();
    if (!connection || connection.status !== "connected") {
      return errorResponse("NOT_CONNECTED", "Verify the WhatsApp connection before sending a reply.", 409);
    }
    const { credentials } = await getEffectiveCredentials();
    if (plan.type === "text" && !isReplyWindowOpen(conversation.lastIncomingMessageAt)) {
      return errorResponse("REPLY_WINDOW_CLOSED", "24-hour reply window closed. Select an approved template to continue.", 409);
    }
    await InboxSendAttempt.updateMany(
      { conversationId: conversation._id, status: "pending", createdAt: { $lt: new Date(Date.now() - 2 * 60 * 1000) } },
      { $set: { status: "uncertain", errorCode: "SEND_RESULT_UNCERTAIN", errorMessage: "A previous send attempt ended without a confirmed result." } }
    );
    if (await InboxSendAttempt.exists({ conversationId: conversation._id, status: { $in: ["pending", "uncertain"] } })) {
      return errorResponse("UNRESOLVED_SEND", "A previous message has an unconfirmed result. Check WhatsApp before sending another message.", 409);
    }
    const contact = conversation.contactId
      ? await Contact.findById(conversation.contactId).select("businessName contactPerson").lean()
      : null;
    const attempt = await InboxSendAttempt.create({
      requestId,
      conversationId: conversation._id,
      type: plan.type,
      status: "pending"
    });

    try {
      const response = await graphRequest<{ messages?: unknown }>(
        credentials,
        `${encodeURIComponent(credentials.phoneNumberId)}/messages`,
        {
          method: "POST",
          retrySafe: false,
          body: plan.type === "text"
            ? {
              messaging_product: "whatsapp",
              to: phoneNumber.replace(/^\+/, ""),
              type: "text",
              text: { body: plan.text, preview_url: false }
            }
            : {
              messaging_product: "whatsapp",
              to: phoneNumber.replace(/^\+/, ""),
              type: "template",
              template: {
                name: plan.templateName,
                language: { code: plan.templateLanguage },
                ...(plan.components?.length ? { components: plan.components } : {})
              }
            }
        }
      );
      const first = Array.isArray(response.messages) ? response.messages[0] : null;
      const messageId = isRecord(first) && typeof first.id === "string" ? first.id : "";
      if (!messageId) {
        await InboxSendAttempt.updateOne(
          { _id: attempt._id, status: "pending" },
          { $set: { status: "uncertain", errorCode: "META_UNCONFIRMED_RESPONSE", errorMessage: "Meta returned no message ID." } }
        );
        return errorResponse("META_UNCONFIRMED_RESPONSE", "Meta did not confirm the message ID. Check WhatsApp before sending again.", 502);
      }
      const reportedStatus = isRecord(first) && typeof first.message_status === "string"
        ? first.message_status.toLowerCase()
        : "accepted";
      const status = ["accepted", "sent", "delivered", "read", "failed"].includes(reportedStatus) ? reportedStatus : "accepted";
      const statusRank = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 2 }[status as "accepted" | "sent" | "delivered" | "read" | "failed"];
      const sentAt = new Date();
      await WhatsAppMessage.updateOne(
        { messageId },
        {
          $set: {
            requestId,
            conversationId: conversation._id,
            whatsappContactId: phoneNumber.replace(/^\+/, ""),
            phoneNumber,
            contactName: contact?.contactPerson ?? conversation.contactName,
            messageType: plan.type,
            content: plan.text,
            metadata: plan.metadata,
            direction: "outgoing",
            ...(conversation.contactId ? { contactId: conversation.contactId } : {})
          },
          $setOnInsert: { messageId, messageTimestamp: sentAt, status, statusRank }
        },
        { upsert: true }
      );
      await InboxSendAttempt.updateOne(
        { _id: attempt._id, status: "pending" },
        { $set: { status: status === "failed" ? "failed" : "accepted", messageId, errorCode: status === "failed" ? "META_MESSAGE_FAILED" : "" } }
      );
      await updateConversationActivity(conversation._id, plan.text, sentAt, "outgoing");
      if (status === "failed") return errorResponse("META_MESSAGE_FAILED", "Meta reported that the message failed.", 502);
      return NextResponse.json({ messageId, status });
    } catch (error) {
      const uncertain = error instanceof MetaApiError &&
        ["META_TIMEOUT", "META_NETWORK_ERROR", "META_UNCONFIRMED_RESPONSE"].includes(error.code);
      const code = error instanceof MetaApiError ? error.code : "SEND_RESULT_UNCERTAIN";
      const message = error instanceof Error ? error.message : "The send result could not be confirmed.";
      await InboxSendAttempt.updateOne(
        { _id: attempt._id, status: "pending" },
        { $set: { status: uncertain ? "uncertain" : "failed", errorCode: code, errorMessage: message.slice(0, 1000) } }
      );
      if (error instanceof MetaApiError && ["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)) {
        await markConnectionError(error.message);
      }
      if (uncertain) return errorResponse(code, "The send result is uncertain. Check the conversation before sending again.", 502);
      if (error instanceof MetaApiError) return errorResponse(error.code, error.message, error.httpStatus);
      console.error("Inbox message could not be sent.", error);
      return errorResponse(code, "Message could not be sent. This request will not be retried automatically.", 500);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      const prior = await InboxSendAttempt.findOne({ requestId }).lean();
      if (prior?.status === "accepted" && prior.messageId) {
        return NextResponse.json({ messageId: prior.messageId, status: "accepted", duplicate: true });
      }
      return errorResponse("REQUEST_ALREADY_ATTEMPTED", "This message request was already attempted; check the conversation before trying again.", 409);
    }
    if (error instanceof MetaApiError) {
      if (["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)) {
        await markConnectionError(error.message);
      }
      return errorResponse(error.code, error.message, error.httpStatus);
    }
    console.error("Inbox message request failed.", error);
    return errorResponse("MESSAGE_SEND_FAILED", "Message could not be sent.", 500);
  }
}
