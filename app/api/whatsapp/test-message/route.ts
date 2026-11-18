import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { rateLimit } from "@/lib/api/rate-limit";
import { connectToDatabase } from "@/lib/db/mongodb";
import Contact from "@/lib/models/contact";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import WhatsAppTestAttempt from "@/lib/models/whatsapp-test-attempt";
import { getEffectiveCredentials, getStoredConnection, markConnectionError } from "@/lib/whatsapp/config";
import { whatsappApiError } from "@/lib/whatsapp/errors";
import { graphRequest, MetaApiError } from "@/lib/whatsapp/meta";
import { isUsableTestTemplateComponents } from "@/lib/whatsapp/templates";

type TemplateRecord = {
  name?: unknown;
  status?: unknown;
  language?: unknown;
  components?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const limited = rateLimit(request, "whatsapp-test-message", 5);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: { code: "INVALID_TEST_MESSAGE", message: "Test message details are invalid." } }, { status: 400 });
  }

  const contactId = typeof body.contactId === "string" && Types.ObjectId.isValid(body.contactId)
    ? body.contactId
    : "";
  const templateName = validText(body.templateName, 512);
  const templateLanguage = validText(body.templateLanguage, 32);
  const requestId = validText(body.requestId, 64);
  if (
    !contactId ||
    !templateName ||
    !templateLanguage ||
    !requestId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  ) {
    return NextResponse.json(
      { error: { code: "INVALID_TEST_MESSAGE", message: "Select a contact and approved template, and submit a valid request ID." } },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();
    const stored = await getStoredConnection();
    if (!stored || stored.status !== "connected") {
      return NextResponse.json(
        { error: { code: "NOT_CONNECTED", message: "Verify the WhatsApp connection before sending a test message." } },
        { status: 409 }
      );
    }

    const priorAttempt = await WhatsAppTestAttempt.findOne({ requestId }).lean();
    if (priorAttempt) {
      if (priorAttempt.status === "accepted") {
        const existingMessage = await WhatsAppMessage.findOne({ messageId: priorAttempt.messageId })
          .select("status")
          .lean();
        return NextResponse.json({
          messageId: priorAttempt.messageId,
          status: existingMessage?.status ?? "accepted",
          message: "This test request was already accepted by Meta; its current status is shown."
        });
      }
      return NextResponse.json(
        {
          error: {
            code: priorAttempt.status === "pending" ? "REQUEST_PENDING" : priorAttempt.errorCode || "REQUEST_ALREADY_FAILED",
            message: priorAttempt.status === "pending"
              ? "This request has an unconfirmed result. Check WhatsApp before attempting another send."
              : "This request was already attempted. Create a new request only after reviewing its failure."
          }
        },
        { status: 409 }
      );
    }

    const contact = await Contact.findById(contactId)
      .select("phoneNumber marketingConsentStatus consentSource consentTimestamp")
      .lean();
    if (!contact) {
      return NextResponse.json({ error: { code: "CONTACT_NOT_FOUND", message: "Selected contact was not found." } }, { status: 404 });
    }
    if (
      contact.marketingConsentStatus !== "Opted In" ||
      !contact.consentSource ||
      !contact.consentTimestamp ||
      Number.isNaN(contact.consentTimestamp.getTime()) ||
      contact.consentTimestamp.getTime() > Date.now()
    ) {
      return NextResponse.json(
        { error: { code: "CONSENT_REQUIRED", message: "A documented Opted In contact is required for a test message." } },
        { status: 400 }
      );
    }

    const { credentials } = await getEffectiveCredentials();
    const templates = await graphRequest<{ data?: unknown }>(
      credentials,
      `${encodeURIComponent(credentials.wabaId)}/message_templates?fields=name,status,language,components&name=${encodeURIComponent(templateName)}&limit=100`
    );
    const templateList = Array.isArray(templates.data) ? templates.data : [];
    const template = templateList.find(
      (item): item is TemplateRecord =>
        isRecord(item) && item.name === templateName && item.language === templateLanguage
    );
    if (!template || template.status !== "APPROVED") {
      return NextResponse.json(
        { error: { code: "TEMPLATE_NOT_APPROVED", message: "Choose an approved template and language available in this WhatsApp Business Account." } },
        { status: 400 }
      );
    }
    const components = Array.isArray(template.components) ? template.components : [];
    if (!isUsableTestTemplateComponents(components)) {
      return NextResponse.json(
        { error: { code: "TEMPLATE_PARAMETERS_REQUIRED", message: "This template requires parameters or media; choose a simple approved text template for this test." } },
        { status: 400 }
      );
    }

    try {
      await WhatsAppTestAttempt.create({
        requestId,
        status: "pending",
        contactId: contact._id
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        return NextResponse.json(
          { error: { code: "REQUEST_PENDING", message: "This test request has already been submitted." } },
          { status: 409 }
        );
      }
      throw error;
    }

    let response: { messages?: unknown };
    try {
      response = await graphRequest<{ messages?: unknown }>(
        credentials,
        `${encodeURIComponent(credentials.phoneNumberId)}/messages`,
        {
          method: "POST",
          retrySafe: false,
          body: {
            messaging_product: "whatsapp",
            to: contact.phoneNumber.replace(/^\+/, ""),
            type: "template",
            template: {
              name: templateName,
              language: { code: templateLanguage }
            }
          }
        }
      );
    } catch (error) {
      if (
        error instanceof MetaApiError &&
        error.code !== "META_TIMEOUT" &&
        error.code !== "META_NETWORK_ERROR"
      ) {
        await WhatsAppTestAttempt.updateOne(
          { requestId, status: "pending" },
          { $set: { status: "failed", errorCode: error.code } }
        );
      }
      throw error;
    }

    const messages = Array.isArray(response.messages) ? response.messages : [];
    const firstMessage = messages[0];
    const messageId = isRecord(firstMessage) && typeof firstMessage.id === "string" ? firstMessage.id : "";
    if (!messageId) {
      throw new MetaApiError(
        "Meta returned an unconfirmed response. Check WhatsApp before sending another test message.",
        "META_UNCONFIRMED_RESPONSE",
        502
      );
    }

    const actualStatus: "accepted" | "sent" | "delivered" | "read" | "failed" =
      isRecord(firstMessage) &&
      typeof firstMessage.message_status === "string" &&
      ["accepted", "sent", "delivered", "read", "failed"].includes(firstMessage.message_status)
        ? (firstMessage.message_status as "accepted" | "sent" | "delivered" | "read" | "failed")
        : "accepted";
    const statusRank = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 }[actualStatus];

    await WhatsAppMessage.updateOne(
      { messageId },
      {
        $set: {
          requestId,
          whatsappContactId: contact.phoneNumber.replace(/^\+/, ""),
          phoneNumber: contact.phoneNumber,
          contactName: "",
          messageType: "template",
          content: templateName,
          metadata: { templateName, templateLanguage },
          direction: "outgoing",
          contactId: contact._id
        },
        $setOnInsert: {
          messageId,
          status: actualStatus,
          statusRank
        }
      },
      { upsert: true }
    );
    await WhatsAppTestAttempt.updateOne(
      { requestId, status: "pending" },
      { $set: { status: actualStatus === "failed" ? "failed" : "accepted", messageId, errorCode: actualStatus === "failed" ? "META_MESSAGE_FAILED" : "" } }
    );

    if (actualStatus === "failed") {
      return NextResponse.json(
        { error: { code: "META_MESSAGE_FAILED", message: "Meta reported that the test message failed.", messageId } },
        { status: 502 }
      );
    }

    return NextResponse.json({
      messageId,
      status: actualStatus,
      message: "Meta accepted the test message. Delivery updates will arrive through the webhook."
    });
  } catch (error) {
    if (
      error instanceof MetaApiError &&
      ["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)
    ) {
      await markConnectionError(error.message);
    }
    return whatsappApiError(error);
  }
}
