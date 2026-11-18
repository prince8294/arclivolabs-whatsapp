import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Conversation from "@/lib/models/conversation";
import InboxSendAttempt from "@/lib/models/inbox-send-attempt";
import WhatsAppMessage from "@/lib/models/whatsapp-message";

type RouteContext = { params: { id: string } };

export async function GET(request: NextRequest, { params }: RouteContext) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation was not found." } }, { status: 404 });
  }
  const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: { code: "INVALID_PAGE", message: "Message page is invalid." } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    const conversation = await Conversation.findById(params.id).lean();
    if (!conversation) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation was not found." } }, { status: 404 });
    const criteria = {
      $or: [
        { conversationId: conversation._id },
        { phoneNumber: conversation.phoneNumber }
      ]
    };
    const pageSize = 50;
    const [records, total, hasUncertainSend] = await Promise.all([
      WhatsAppMessage.find(criteria)
        .sort({ messageTimestamp: -1, createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      WhatsAppMessage.countDocuments(criteria),
      InboxSendAttempt.exists({ conversationId: conversation._id, status: { $in: ["pending", "uncertain"] } })
    ]);
    const messages = records.reverse().map((item) => ({
      _id: String(item._id),
      messageId: item.messageId ?? "",
      direction: item.direction,
      type: item.messageType,
      text: item.content,
      status: item.status === "accepted" ? "pending" : item.status,
      timestamp: (item.messageTimestamp ?? item.createdAt).toISOString(),
      isReadInternally: item.isReadInternally === true,
      failureCode: item.failureCode,
      failureMessage: item.failureMessage,
      metadata: item.metadata
    }));
    const lastIncomingMessageAt = conversation.lastIncomingMessageAt?.toISOString() ?? null;
    const age = conversation.lastIncomingMessageAt ? Date.now() - conversation.lastIncomingMessageAt.getTime() : Number.POSITIVE_INFINITY;
    return NextResponse.json({
      messages,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      lastIncomingMessageAt,
      replyWindowOpen: age >= 0 && age < 24 * 60 * 60 * 1000,
      hasUncertainSend: Boolean(hasUncertainSend)
    });
  } catch (error) {
    console.error("Inbox message history could not be loaded.", error);
    return NextResponse.json({ error: { code: "MESSAGE_HISTORY_FAILED", message: "Message history could not be loaded." } }, { status: 500 });
  }
}
