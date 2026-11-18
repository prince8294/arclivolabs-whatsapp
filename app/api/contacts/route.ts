import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { contactServerError, duplicatePhoneResponse } from "@/lib/api/contact-errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import { marketingConsentStatuses, validateConsentInput, validateContactProfile } from "@/lib/contacts/validation";
import { getContactStats } from "@/lib/data/contact-stats";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";
import MessageSuppression from "@/lib/models/message-suppression";

function unauthorized() {
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
}

function escapedRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) return unauthorized();

  const searchParams = request.nextUrl.searchParams;
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 20);
  const search = (searchParams.get("search") ?? "").trim().slice(0, 100);
  const categoryValue = searchParams.get("categoryId");
  const city = (searchParams.get("city") ?? "").trim().slice(0, 100);
  const consent = searchParams.get("consent") ?? "";

  if (!Number.isInteger(page) || page < 1 || ![20, 50].includes(pageSize)) {
    return NextResponse.json({ error: { code: "INVALID_PAGINATION", message: "Page or page size is invalid." } }, { status: 400 });
  }
  if (categoryValue && !Types.ObjectId.isValid(categoryValue)) {
    return NextResponse.json({ error: { code: "INVALID_CATEGORY", message: "Category filter is invalid." } }, { status: 400 });
  }
  if (consent && !marketingConsentStatuses.includes(consent as (typeof marketingConsentStatuses)[number])) {
    return NextResponse.json({ error: { code: "INVALID_CONSENT", message: "Consent filter is invalid." } }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const filter: Record<string, unknown> = {};
    if (categoryValue) filter.categoryId = new Types.ObjectId(categoryValue);
    if (city) filter.city = city;
    if (consent) filter.marketingConsentStatus = consent;
    if (search) {
      const regex = new RegExp(escapedRegex(search), "i");
      filter.$or = [
        { businessName: regex },
        { contactPerson: regex },
        { phoneNumber: regex },
        { city: regex }
      ];
    }

    const skip = (page - 1) * pageSize;
    const [contacts, filteredTotal, stats, cities] = await Promise.all([
      Contact.find(filter)
        .select("-consentHistory -consentSource -consentTimestamp")
        .populate("categoryId", "name icon")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      Contact.countDocuments(filter),
      getContactStats(),
      Contact.distinct("city", { city: { $exists: true, $ne: "" } })
    ]);

    return NextResponse.json({
      contacts,
      page,
      pageSize,
      total: filteredTotal,
      totalPages: Math.ceil(filteredTotal / pageSize),
      cities: (cities as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      stats
    });
  } catch (error) {
    return contactServerError(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) return unauthorized();
  const limited = rateLimit(request, "contact-create", 60);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }

  const profile = validateContactProfile(body);
  if (!profile.ok) {
    return NextResponse.json({ error: { code: "INVALID_CONTACT", message: profile.message } }, { status: 400 });
  }
  const consent = validateConsentInput(body as Record<string, unknown>);
  if (!consent.ok) {
    return NextResponse.json({ error: { code: "INVALID_CONSENT", message: consent.message } }, { status: 400 });
  }
  if (consent.value.status === "Opted In" && (body as Record<string, unknown>).permissionDocumented !== true) {
    return NextResponse.json(
      { error: { code: "DOCUMENTATION_REQUIRED", message: "Confirm documented permission before opting in this contact." } },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();
    if (!(await Category.exists({ _id: profile.value.categoryId }))) {
      return NextResponse.json({ error: { code: "CATEGORY_NOT_FOUND", message: "Selected category was not found." } }, { status: 400 });
    }

    const entry =
      consent.value.status === "Unknown"
        ? []
        : [{ status: consent.value.status, source: consent.value.source, timestamp: consent.value.timestamp! }];
    const contact = await Contact.create({
      ...profile.value,
      marketingConsentStatus: consent.value.status,
      consentSource: consent.value.source,
      consentTimestamp: consent.value.timestamp,
      consentHistory: entry
    });
    if (consent.value.status === "Opted Out") {
      await MessageSuppression.updateOne(
        { phoneNumber: profile.value.phoneNumber },
        { $set: { contactId: contact._id, reason: "Opted Out", source: consent.value.source, suppressedAt: consent.value.timestamp } },
        { upsert: true }
      );
    }
    await contact.populate("categoryId", "name icon");
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return duplicatePhoneResponse();
    }
    return contactServerError(error);
  }
}
