import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Conversation from "@/lib/models/conversation";

type RouteContext = { params: { id: string } };

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
  const notes = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).notes : null;
  if (typeof notes !== "string" || notes.length > 2000) {
    return NextResponse.json({ error: { code: "INVALID_NOTES", message: "Notes must be 2,000 characters or fewer." } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    const conversation = await Conversation.findByIdAndUpdate(
      params.id,
      { $set: { notes: notes.trim() } },
      { new: true, runValidators: true }
    ).select("notes").lean();
    if (!conversation) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation was not found." } }, { status: 404 });
    return NextResponse.json({ notes: conversation.notes });
  } catch (error) {
    console.error("Conversation notes could not be updated.", error);
    return NextResponse.json({ error: { code: "NOTES_UPDATE_FAILED", message: "Notes could not be updated." } }, { status: 500 });
  }
}
