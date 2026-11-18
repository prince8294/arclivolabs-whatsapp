import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Types } from "mongoose";

export const marketingConsentStatuses = ["Unknown", "Opted In", "Opted Out"] as const;
export type MarketingConsentStatus = (typeof marketingConsentStatuses)[number];

export type ContactProfileInput = {
  businessName: string;
  contactPerson: string;
  phoneNumber: string;
  categoryId: Types.ObjectId;
  city: string;
  state: string;
  email: string;
  notes: string;
};

export type ContactValidationResult =
  | { ok: true; value: ContactProfileInput }
  | { ok: false; message: string };

function text(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length <= maxLength ? result : null;
}

export function normalizePhoneNumber(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const parsed = parsePhoneNumberFromString(raw, raw.startsWith("+") ? undefined : "IN");
  if (!parsed || !parsed.isValid() || parsed.ext) return null;
  return parsed.number;
}

export function validateContactProfile(body: unknown): ContactValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Contact data must be an object." };
  }

  const values = body as Record<string, unknown>;
  const businessName = text(values.businessName, 160);
  const contactPerson = text(values.contactPerson, 120);
  const city = text(values.city, 100);
  const state = text(values.state, 100);
  const email = text(values.email, 254);
  const notes = text(values.notes, 2000);
  if (businessName === null || !businessName) {
    return { ok: false, message: "Business name is required and must be 160 characters or fewer." };
  }
  if (contactPerson === null || city === null || state === null || email === null || notes === null) {
    return { ok: false, message: "One or more optional fields exceed their allowed length or have an invalid type." };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const phoneNumber = normalizePhoneNumber(values.phoneNumber);
  if (!phoneNumber) {
    return { ok: false, message: "Enter a valid international WhatsApp number, including the country code when needed." };
  }
  if (typeof values.categoryId !== "string" || !Types.ObjectId.isValid(values.categoryId)) {
    return { ok: false, message: "Select a valid business category." };
  }

  return {
    ok: true,
    value: {
      businessName,
      contactPerson,
      phoneNumber,
      categoryId: new Types.ObjectId(values.categoryId),
      city,
      state,
      email: email.toLowerCase(),
      notes
    }
  };
}

export type ConsentInput = {
  status: MarketingConsentStatus;
  source: string;
  timestamp: Date | null;
};

export type ConsentValidationResult =
  | { ok: true; value: ConsentInput }
  | { ok: false; message: string };

export function validateConsentInput(body: Record<string, unknown>): ConsentValidationResult {
  const statusValue = body.marketingConsentStatus ?? "Unknown";
  if (typeof statusValue !== "string" || !marketingConsentStatuses.includes(statusValue as MarketingConsentStatus)) {
    return { ok: false, message: "Choose Unknown, Opted In, or Opted Out for marketing consent." };
  }

  const status = statusValue as MarketingConsentStatus;
  const sourceValue = body.consentSource ?? "";
  if (typeof sourceValue !== "string" || sourceValue.trim().length > 120) {
    return { ok: false, message: "Consent source must be 120 characters or fewer." };
  }
  const source = sourceValue.trim();
  const timestampValue = body.consentTimestamp;
  let timestamp: Date | null = null;
  if (timestampValue !== undefined && timestampValue !== null && timestampValue !== "") {
    timestamp = new Date(String(timestampValue));
    if (Number.isNaN(timestamp.getTime()) || timestamp.getTime() > Date.now()) {
      return { ok: false, message: "Consent date must be a valid date that is not in the future." };
    }
  }

  if (status !== "Unknown" && (!source || !timestamp)) {
    return { ok: false, message: "A consent source and date are required for opted-in or opted-out contacts." };
  }
  if (status === "Unknown" && (source || timestamp)) {
    return { ok: false, message: "Unknown consent cannot include a consent source or date." };
  }
  return { ok: true, value: { status, source, timestamp } };
}
