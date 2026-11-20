import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { contactServerError } from "@/lib/api/contact-errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { validateConsentInput, type MarketingConsentStatus } from "@/lib/contacts/validation";
import { connectToDatabase } from "@/lib/db/mongodb";
import Contact from "@/lib/models/contact";
import MessageSuppression from "@/lib/models/message-suppression";

type RouteContext = { params: { id: string } };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const limited = rateLimit(request, "contact-consent", 30);
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: { code: "INVALID_CONSENT", message: "Consent data must be an object." } }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  if (Object.keys(values).length === 1 && Object.prototype.hasOwnProperty.call(values, "doNotContact")) {
    if (typeof values.doNotContact !== "boolean") {
      return NextResponse.json({ error: { code: "INVALID_DNC", message: "Do Not Contact must be true or false." } }, { status: 400 });
    }
    try {
      await connectToDatabase();
      const contact = await Contact.findById(params.id);
      if (!contact) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Contact was not found." } }, { status: 404 });
      contact.doNotContact = values.doNotContact;
      await contact.save();
      if (values.doNotContact) {
        await MessageSuppression.updateOne(
          { phoneNumber: contact.phoneNumber },
          {
            $setOnInsert: {
              phoneNumber: contact.phoneNumber,
              contactId: contact._id,
              reason: "Do Not Contact",
              source: "CRM Do Not Contact flag",
              suppressedAt: new Date()
            }
          },
          { upsert: true }
        );
      } else if (contact.marketingConsentStatus !== "Opted Out") {
        await MessageSuppression.deleteOne({ phoneNumber: contact.phoneNumber, reason: "Do Not Contact" });
      }
      await contact.populate("categoryId", "name icon");
      return NextResponse.json({ contact });
    } catch (error) {
      return contactServerError(error);
    }
  }
  const parsed = validateConsentInput(values);
  if (!parsed.ok) {
    return NextResponse.json({ error: { code: "INVALID_CONSENT", message: parsed.message } }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const contact = await Contact.findById(params.id);
    if (!contact) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Contact was not found." } }, { status: 404 });
    }

    const previousStatus = contact.marketingConsentStatus as MarketingConsentStatus;
    if (
      parsed.value.status === "Opted In" &&
      previousStatus !== "Opted In" &&
      values.permissionDocumented !== true
    ) {
      return NextResponse.json(
        { error: { code: "DOCUMENTATION_REQUIRED", message: "Confirm documented permission before opting in this contact." } },
        { status: 400 }
      );
    }

    contact.marketingConsentStatus = parsed.value.status;
    contact.consentSource = parsed.value.source;
    contact.consentTimestamp = parsed.value.timestamp;
    if (parsed.value.status !== "Unknown" && parsed.value.timestamp) {
      contact.consentHistory.push({
        status: parsed.value.status,
        source: parsed.value.source,
        timestamp: parsed.value.timestamp
      });
    }
    await contact.save();
    if (parsed.value.status === "Opted Out") {
      await MessageSuppression.updateOne(
        { phoneNumber: contact.phoneNumber },
        {
          $set: {
            contactId: contact._id,
            reason: "Opted Out",
            source: parsed.value.source,
            suppressedAt: parsed.value.timestamp ?? new Date()
          }
        },
        { upsert: true }
      );
    } else if (parsed.value.status === "Opted In") {
      await MessageSuppression.deleteOne({ phoneNumber: contact.phoneNumber });
    }
    await contact.populate("categoryId", "name icon");
    return NextResponse.json({ contact });
  } catch (error) {
    return contactServerError(error);
  }
}
