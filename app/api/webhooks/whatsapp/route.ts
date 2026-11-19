import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizePhoneNumber } from "@/lib/contacts/validation";
import { connectToDatabase } from "@/lib/db/mongodb";
import Contact from "@/lib/models/contact";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import Conversation from "@/lib/models/conversation";
import MessageTemplate from "@/lib/models/message-template";
import WhatsAppWebhookEvent from "@/lib/models/whatsapp-webhook-event";
import { getEffectiveCredentials } from "@/lib/whatsapp/config";
import { applyMessageDeliveryStatus } from "@/lib/campaigns/delivery";
import { getOrCreateConversation, refreshUnreadCount, updateConversationActivity } from "@/lib/inbox/conversations";

export const runtime = "nodejs";
const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function timestamp(value: unknown) {
  const seconds = typeof value === "string" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizedSender(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const international = raw.startsWith("+") ? raw : `+${raw.replace(/\D/g, "")}`;
  return normalizePhoneNumber(international) ?? normalizePhoneNumber(raw) ?? raw;
}

function metadataFor(message: JsonRecord, type: string) {
  if (type === "text") return {};
  const item = message[type];
  if (!isRecord(item)) return {};
  const metadata: JsonRecord = {};
  for (const key of ["id", "mime_type", "sha256", "filename", "caption", "voice", "animated"]) {
    const value = item[key];
    if (typeof value === "string") metadata[key] = value.slice(0, 1000);
    if (typeof value === "boolean") metadata[key] = value;
  }
  return metadata;
}

function eventKey(type: string, id: string, timestampValue: unknown, status: string) {
  return createHash("sha256")
    .update(`${type}:${id}:${String(timestampValue ?? "")}:${status}`)
    .digest("hex");
}

async function claimEvent(key: string, type: string) {
  try {
    const created = await WhatsAppWebhookEvent.create({ eventKey: key, eventType: type });
    return created.processedAt === null;
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
    const existing = await WhatsAppWebhookEvent.findOne({ eventKey: key }).lean();
    return Boolean(existing && !existing.processedAt);
  }
}

async function markEventProcessed(key: string) {
  await WhatsAppWebhookEvent.updateOne(
    { eventKey: key, processedAt: null },
    { $set: { processedAt: new Date() } }
  );
}

async function readWebhookBody(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return null;
  }
  if (!request.body) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

async function storeIncomingMessage(message: JsonRecord, contacts: unknown) {
  const messageId = stringValue(message.id);
  const sender = stringValue(message.from);
  const type = stringValue(message.type) || "unknown";
  if (!messageId || messageId.length > 255 || !sender || sender.length > 40) return;

  const event = eventKey("message", messageId, message.timestamp, "");
  if (!(await claimEvent(event, "message"))) return;

  const contactRows = Array.isArray(contacts) ? contacts : [];
  const matchingSender = contactRows.find(
    (item) => isRecord(item) && stringValue(item.wa_id) === sender
  );
  const profile = isRecord(matchingSender) && isRecord(matchingSender.profile) ? matchingSender.profile : null;
  const contactName = profile ? stringValue(profile.name).slice(0, 160) : "";
  const phoneNumber = normalizedSender(sender);
  const contact = phoneNumber
    ? await Contact.findOne({ phoneNumber }).select("_id businessName contactPerson").lean()
    : null;
  const conversation = await getOrCreateConversation({
    phoneNumber,
    contactId: contact?._id ?? null,
    businessName: contact?.businessName || contactName,
    contactName: contact?.contactPerson || contactName
  });
  const context = isRecord(message.context) ? message.context : null;
  const repliedToMessageId = context ? stringValue(context.id).slice(0, 255) : "";
  const repliedToCampaignMessage = repliedToMessageId
    ? await WhatsAppMessage.findOne({ messageId: repliedToMessageId, direction: "outgoing" })
      .select("campaignId campaignRecipientId")
      .lean()
    : null;

  const text = isRecord(message.text) ? stringValue(message.text.body) : "";
  await WhatsAppMessage.updateOne(
    { messageId },
    {
      $set: {
        conversationId: conversation._id,
        ...(contact?._id ? { contactId: contact._id } : {}),
        ...(repliedToCampaignMessage?.campaignId ? {
          campaignId: repliedToCampaignMessage.campaignId,
          campaignRecipientId: repliedToCampaignMessage.campaignRecipientId
        } : {})
      },
      $setOnInsert: {
        messageId,
        whatsappContactId: sender,
        phoneNumber,
        contactName,
        messageType: type.slice(0, 40),
        content: text.slice(0, 10000),
        metadata: metadataFor(message, type),
        messageTimestamp: timestamp(message.timestamp),
        direction: "incoming",
        status: "received",
        statusRank: 0,
        isReadInternally: false
      }
    },
    { upsert: true }
  );
  const messageAt = timestamp(message.timestamp) ?? new Date();
  await updateConversationActivity(conversation._id, text || `${type} message`, messageAt, "incoming");
  await refreshUnreadCount(conversation._id);
  await markEventProcessed(event);
}

async function storeMessageStatus(status: JsonRecord) {
  const messageId = stringValue(status.id);
  const statusValue = stringValue(status.status).toLowerCase();
  if (!messageId || messageId.length > 255 || !["sent", "delivered", "read", "failed"].includes(statusValue)) return;
  const event = eventKey("status", messageId, status.timestamp, statusValue);
  if (!(await claimEvent(event, "status"))) return;

  const recipient = stringValue(status.recipient_id).slice(0, 40);
  const phoneNumber = normalizedSender(recipient);
  const contact = phoneNumber ? await Contact.findOne({ phoneNumber }).select("_id").lean() : null;
  await WhatsAppMessage.updateOne(
    { messageId },
    {
      $setOnInsert: {
        messageId,
        whatsappContactId: recipient,
        phoneNumber,
        contactName: "",
        messageType: "unknown",
        content: "",
        metadata: {},
        messageTimestamp: timestamp(status.timestamp),
        direction: "outgoing",
        status: "accepted",
        statusRank: 0,
        contactId: contact?._id ?? null
      }
    },
    { upsert: true }
  );

  let failureCode = "";
  let failureMessage = "";
  if (statusValue === "failed" && Array.isArray(status.errors)) {
    const firstError = status.errors.find(isRecord);
    if (firstError && (typeof firstError.code === "number" || typeof firstError.code === "string")) {
      failureCode = String(firstError.code).slice(0, 80);
      const errorData = isRecord(firstError.error_data) ? firstError.error_data : null;
      failureMessage = stringValue(errorData?.details || firstError.title || firstError.message).slice(0, 1000);
    }
  }
  await applyMessageDeliveryStatus(messageId, statusValue, failureCode, failureMessage);
  await markEventProcessed(event);
}

async function storeTemplateStatus(value: JsonRecord) {
  const templateId = stringValue(value.message_template_id);
  const templateName = stringValue(value.message_template_name).toLowerCase();
  const language = stringValue(value.message_template_language);
  const status = stringValue(value.event);
  if (!status || (!templateId && (!templateName || !language))) return;
  const event = eventKey("template", templateId || `${templateName}:${language}`, value.timestamp, status);
  if (!(await claimEvent(event, "message_template_status_update"))) return;

  const filter = templateId
    ? { metaTemplateId: templateId }
    : { name: templateName, language };
  const update: JsonRecord = { metaStatus: status, lastSyncedAt: new Date() };
  const reason = stringValue(value.reason);
  if (reason) update.rejectionReason = reason.slice(0, 2000);
  await MessageTemplate.updateOne(filter, {
    $set: update,
    ...(!reason ? { $unset: { rejectionReason: 1 } } : {})
  });
  await markEventProcessed(event);
}

export async function GET(request: NextRequest) {
  let verifyToken = "";
  try {
    const { credentials } = await getEffectiveCredentials();
    verifyToken = credentials.verifyToken;
  } catch {
    return new NextResponse("Webhook verification is not configured.", { status: 503 });
  }

  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token") ?? "";
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const supplied = Buffer.from(token);
  const expected = Buffer.from(verifyToken);
  if (
    mode !== "subscribe" ||
    !challenge ||
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return new NextResponse("Webhook verification failed.", { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  const body = await readWebhookBody(request);
  if (!body) {
    return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  }

  let appSecret = "";
  let configuredWabaId = "";
  let configuredPhoneNumberId = "";
  try {
    const { credentials } = await getEffectiveCredentials();
    appSecret = credentials.appSecret;
    configuredWabaId = credentials.wabaId;
    configuredPhoneNumberId = credentials.phoneNumberId;
  } catch {
    return NextResponse.json({ error: "Webhook signature verification is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const expectedSignature = createHmac("sha256", appSecret).update(body).digest();
  const signatureMatch = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!signatureMatch) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  const receivedSignature = Buffer.from(signatureMatch[1], "hex");
  if (!timingSafeEqual(expectedSignature, receivedSignature)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Webhook body must be valid JSON." }, { status: 400 });
  }
  if (!isRecord(payload) || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) {
    return NextResponse.json({ error: "Webhook payload is invalid." }, { status: 400 });
  }

  try {
    await connectToDatabase();
    for (const entry of payload.entry) {
      if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
      if (stringValue(entry.id) !== configuredWabaId) continue;
      for (const change of entry.changes) {
        if (!isRecord(change) || !isRecord(change.value)) continue;
        const value = change.value;
        const metadata = isRecord(value.metadata) ? value.metadata : null;
        if (metadata && stringValue(metadata.phone_number_id) !== configuredPhoneNumberId) continue;
        if (change.field === "message_template_status_update") {
          await storeTemplateStatus(value);
        }
        const contactRows = value.contacts;
        if (Array.isArray(value.messages)) {
          for (const message of value.messages) {
            if (isRecord(message)) await storeIncomingMessage(message, contactRows);
          }
        }
        if (Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            if (isRecord(status)) await storeMessageStatus(status);
          }
        }
      }
    }
    return NextResponse.json({ received: true });
  } catch {
    console.error("WhatsApp webhook processing failed.");
    return NextResponse.json({ error: "Webhook event could not be stored. Meta may retry this notification." }, { status: 500 });
  }
}
