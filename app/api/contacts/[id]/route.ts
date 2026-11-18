import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { contactServerError, duplicatePhoneResponse } from "@/lib/api/contact-errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { validateContactProfile } from "@/lib/contacts/validation";
import { connectToDatabase } from "@/lib/db/mongodb";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";

type RouteContext = { params: { id: string } };

function unauthorized() {
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  if (!isAdminSessionValid(request)) return unauthorized();
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "INVALID_ID", message: "Contact ID is invalid." } }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const contact = await Contact.findById(params.id).populate("categoryId", "name icon");
    if (!contact) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Contact was not found." } }, { status: 404 });
    }
    return NextResponse.json({ contact });
  } catch (error) {
    return contactServerError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) return unauthorized();
  const limited = rateLimit(request, "contact-update", 60);
  if (limited) return limited;
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "INVALID_ID", message: "Contact ID is invalid." } }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (
    body &&
    typeof body === "object" &&
    ["marketingConsentStatus", "consentSource", "consentTimestamp", "consentHistory"].some((key) =>
      Object.prototype.hasOwnProperty.call(body, key)
    )
  ) {
    return NextResponse.json(
      { error: { code: "CONSENT_REQUIRES_AUDIT", message: "Use the consent management action to change consent status." } },
      { status: 400 }
    );
  }

  const profile = validateContactProfile(body);
  if (!profile.ok) {
    return NextResponse.json({ error: { code: "INVALID_CONTACT", message: profile.message } }, { status: 400 });
  }

  try {
    await connectToDatabase();
    if (!(await Category.exists({ _id: profile.value.categoryId }))) {
      return NextResponse.json({ error: { code: "CATEGORY_NOT_FOUND", message: "Selected category was not found." } }, { status: 400 });
    }
    const contact = await Contact.findById(params.id);
    if (!contact) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Contact was not found." } }, { status: 404 });
    }

    Object.assign(contact, profile.value);
    await contact.save();
    await contact.populate("categoryId", "name icon");
    return NextResponse.json({ contact });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return duplicatePhoneResponse();
    }
    return contactServerError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) return unauthorized();
  const limited = rateLimit(request, "contact-delete", 30);
  if (limited) return limited;
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "INVALID_ID", message: "Contact ID is invalid." } }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const result = await Contact.findByIdAndDelete(params.id);
    if (!result) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Contact was not found." } }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return contactServerError(error);
  }
}
