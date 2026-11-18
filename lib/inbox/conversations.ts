import { Types } from "mongoose";
import Conversation from "@/lib/models/conversation";
import WhatsAppMessage from "@/lib/models/whatsapp-message";

export async function getOrCreateConversation(input: {
  phoneNumber: string;
  contactId?: Types.ObjectId | null;
  businessName?: string;
  contactName?: string;
}) {
  const fields: Record<string, unknown> = {};
  if (input.contactId) fields.contactId = input.contactId;
  if (input.businessName) fields.businessName = input.businessName.slice(0, 160);
  if (input.contactName) fields.contactName = input.contactName.slice(0, 160);

  try {
    return await Conversation.findOneAndUpdate(
      { phoneNumber: input.phoneNumber },
      {
        $setOnInsert: { phoneNumber: input.phoneNumber },
        ...(Object.keys(fields).length ? { $set: fields } : {})
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
    const existing = await Conversation.findOne({ phoneNumber: input.phoneNumber }).lean();
    if (!existing) throw error;
    return existing;
  }
}

export async function updateConversationActivity(
  conversationId: Types.ObjectId,
  text: string,
  messageAt: Date,
  direction: "incoming" | "outgoing"
) {
  await Conversation.updateOne(
    { _id: conversationId },
    { $max: { lastContactedAt: messageAt, ...(direction === "incoming" ? { lastIncomingMessageAt: messageAt } : {}) } }
  );
  await Conversation.updateOne(
    {
      _id: conversationId,
      $or: [{ lastMessageAt: null }, { lastMessageAt: { $lte: messageAt } }]
    },
    { $set: { lastMessage: text.slice(0, 4096), lastMessageAt: messageAt } }
  );
}

export async function refreshUnreadCount(conversationId: Types.ObjectId) {
  const unreadCount = await WhatsAppMessage.countDocuments({
    conversationId,
    direction: "incoming",
    isReadInternally: { $ne: true }
  });
  await Conversation.updateOne({ _id: conversationId }, { $set: { unreadCount } });
  return unreadCount;
}
