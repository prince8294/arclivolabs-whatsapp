import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import { followUpStatuses, leadStatuses } from "@/lib/leads/query";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";
import Conversation from "@/lib/models/conversation";

type RouteContext = { params: { id: string } };

function badRequest(message: string) {
  return NextResponse.json({ error: { code: "INVALID_LEAD_UPDATE", message } }, { status: 400 });
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Lead was not found." } }, { status: 404 });
  }
  try {
    await connectToDatabase();
    const lead = await Conversation.findOne({ _id: params.id, isLeadActive: { $ne: false } }).lean();
    if (!lead) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Lead was not found." } }, { status: 404 });
    const contact = (lead.contactId ? await Contact.findById(lead.contactId).lean() : null)
      || await Contact.findOne({ phoneNumber: lead.phoneNumber }).lean();
    const category = contact ? await Category.findById(contact.categoryId).select("name").lean() : null;
    return NextResponse.json({
      lead: {
        _id: String(lead._id),
        contactId: contact ? String(contact._id) : null,
        businessName: contact?.businessName || lead.businessName || contact?.contactPerson || lead.contactName || lead.phoneNumber,
        contactPerson: contact?.contactPerson || lead.contactName || "",
        phoneNumber: lead.phoneNumber,
        categoryName: category?.name ?? "",
        city: contact?.city ?? "",
        email: contact?.email ?? "",
        leadStatus: lead.leadStatus ?? "New",
        followUpStatus: lead.followUpStatus ?? "Not Required",
        followUpDate: lead.followUpDate?.toISOString().slice(0, 10) ?? "",
        followUpNotes: lead.followUpNotes ?? "",
        lastContactedAt: lead.lastContactedAt?.toISOString() ?? lead.lastMessageAt?.toISOString() ?? null,
        notes: lead.notes ?? ""
      }
    });
  } catch (error) {
    console.error("Lead details could not be loaded.", error);
    return NextResponse.json({ error: { code: "LEAD_LOAD_FAILED", message: "Lead details could not be loaded." } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Lead was not found." } }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("Lead changes must be an object.");
  const input = body as Record<string, unknown>;
  const allowed = new Set(["leadStatus", "followUpStatus", "followUpDate", "followUpNotes", "notes"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return badRequest("The update contains unsupported fields.");
  const changes: Record<string, unknown> = { isLeadActive: true };
  if ("leadStatus" in input) {
    if (!leadStatuses.includes(input.leadStatus as (typeof leadStatuses)[number])) return badRequest("Choose a valid lead status.");
    changes.leadStatus = input.leadStatus;
    changes.leadStatusUpdatedAt = new Date();
  }
  if ("followUpStatus" in input) {
    if (!followUpStatuses.includes(input.followUpStatus as (typeof followUpStatuses)[number])) return badRequest("Choose a valid follow-up status.");
    changes.followUpStatus = input.followUpStatus;
  }
  if ("followUpDate" in input) {
    if (input.followUpDate === null || input.followUpDate === "") {
      changes.followUpDate = null;
    } else if (typeof input.followUpDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.followUpDate)) {
      const date = new Date(`${input.followUpDate}T00:00:00.000Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.followUpDate) return badRequest("Choose a valid follow-up date.");
      changes.followUpDate = date;
    } else {
      return badRequest("Choose a valid follow-up date.");
    }
  }
  for (const field of ["followUpNotes", "notes"] as const) {
    if (field in input) {
      if (typeof input[field] !== "string" || input[field].length > 2000) return badRequest(`${field === "notes" ? "Notes" : "Follow-up notes"} must be 2,000 characters or fewer.`);
      changes[field] = input[field].trim();
    }
  }
  if (Object.keys(changes).length === 1) return badRequest("Add at least one lead change.");
  try {
    await connectToDatabase();
    const lead = await Conversation.findOneAndUpdate(
      { _id: params.id, isLeadActive: { $ne: false } },
      { $set: changes },
      { new: true, runValidators: true }
    ).lean();
    if (!lead) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Lead was not found." } }, { status: 404 });
    return NextResponse.json({ lead: { _id: String(lead._id), leadStatus: lead.leadStatus, followUpStatus: lead.followUpStatus } });
  } catch (error) {
    console.error("Lead changes could not be saved.", error);
    return NextResponse.json({ error: { code: "LEAD_UPDATE_FAILED", message: "Lead changes could not be saved." } }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Lead was not found." } }, { status: 404 });
  }
  try {
    await connectToDatabase();
    const lead = await Conversation.findOneAndUpdate(
      { _id: params.id, isLeadActive: { $ne: false } },
      { $set: { isLeadActive: false } },
      { new: true }
    ).select("_id").lean();
    if (!lead) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Lead was not found." } }, { status: 404 });
    return NextResponse.json({ archived: true });
  } catch (error) {
    console.error("Lead record could not be removed.", error);
    return NextResponse.json({ error: { code: "LEAD_DELETE_FAILED", message: "Lead record could not be removed." } }, { status: 500 });
  }
}
