import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Conversation from "@/lib/models/conversation";

type RouteContext = { params: { id: string } };
const leadStatuses = ["New", "Interested", "Not Interested", "Closed"] as const;

export async function PATCH(request: NextRequest, { params }: RouteContext) {
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
  if (!body || typeof body !== "object" || Array.isArray(body) || !leadStatuses.includes((body as Record<string, unknown>).leadStatus as (typeof leadStatuses)[number])) {
    return NextResponse.json({ error: { code: "INVALID_LEAD_STATUS", message: "Choose a valid lead status." } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    const conversation = await Conversation.findByIdAndUpdate(
      params.id,
      { $set: { leadStatus: (body as Record<string, unknown>).leadStatus, leadStatusUpdatedAt: new Date(), isLeadActive: true } },
      { new: true, runValidators: true }
    ).lean();
    if (!conversation) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation was not found." } }, { status: 404 });
    return NextResponse.json({ leadStatus: conversation.leadStatus, leadStatusUpdatedAt: conversation.leadStatusUpdatedAt?.toISOString() ?? null });
  } catch (error) {
    console.error("Conversation lead status could not be updated.", error);
    return NextResponse.json({ error: { code: "LEAD_STATUS_UPDATE_FAILED", message: "Lead status could not be updated." } }, { status: 500 });
  }
}
