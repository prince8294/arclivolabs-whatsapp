import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Conversation from "@/lib/models/conversation";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import { refreshUnreadCount } from "@/lib/inbox/conversations";

type RouteContext = { params: { id: string } };

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation was not found." } }, { status: 404 });
  }
  try {
    await connectToDatabase();
    const conversation = await Conversation.findById(params.id).select("_id phoneNumber").lean();
    if (!conversation) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation was not found." } }, { status: 404 });
    await WhatsAppMessage.updateMany(
      {
        direction: "incoming",
        isReadInternally: { $ne: true },
        $or: [{ conversationId: conversation._id }, { phoneNumber: conversation.phoneNumber }]
      },
      { $set: { isReadInternally: true } }
    );
    await Conversation.updateOne({ _id: conversation._id }, { $set: { lastReadAt: new Date(), unreadCount: 0 } });
    const unreadCount = await refreshUnreadCount(conversation._id);
    return NextResponse.json({ unreadCount });
  } catch (error) {
    console.error("Conversation could not be marked read.", error);
    return NextResponse.json({ error: { code: "MARK_READ_FAILED", message: "Conversation could not be marked read." } }, { status: 500 });
  }
}
