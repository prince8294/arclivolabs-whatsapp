import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import InboxSendAttempt from "@/lib/models/inbox-send-attempt";

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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!body || typeof body !== "object" || (body as Record<string, unknown>).confirmNoDelivery !== true) {
    return NextResponse.json({ error: { code: "CONFIRMATION_REQUIRED", message: "Confirm that you checked WhatsApp and verified the uncertain message was not delivered." } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    await InboxSendAttempt.updateMany(
      { conversationId: params.id, status: "pending", createdAt: { $lt: new Date(Date.now() - 2 * 60 * 1000) } },
      { $set: { status: "uncertain", errorCode: "SEND_RESULT_UNCERTAIN", errorMessage: "A previous send attempt ended without a confirmed result." } }
    );
    const result = await InboxSendAttempt.updateMany(
      { conversationId: params.id, status: "uncertain" },
      {
        $set: {
          status: "reviewed",
          errorCode: "ADMIN_REVIEWED",
          errorMessage: "Administrator confirmed the message was not delivered after checking WhatsApp."
        }
      }
    );
    if (!result.modifiedCount) {
      return NextResponse.json({ error: { code: "NO_UNCERTAIN_SEND", message: "There are no uncertain sends to resolve." } }, { status: 409 });
    }
    return NextResponse.json({ resolved: result.modifiedCount });
  } catch (error) {
    console.error("Uncertain inbox send could not be resolved.", error);
    return NextResponse.json({ error: { code: "UNCERTAIN_SEND_RESOLUTION_FAILED", message: "Uncertain send could not be resolved." } }, { status: 500 });
  }
}
