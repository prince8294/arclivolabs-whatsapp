import { Types } from "mongoose";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";
import Conversation from "@/lib/models/conversation";
import MessageSuppression from "@/lib/models/message-suppression";
import MessageTemplate from "@/lib/models/message-template";
import { normalizePhoneNumber, type MarketingConsentStatus } from "@/lib/contacts/validation";
import { extractTemplateVariables } from "@/lib/templates/validation";

export const personalizedModes = ["personalized_csv", "approved_template"] as const;
export type PersonalizedMode = (typeof personalizedModes)[number];

export type PersonalizedCsvRow = {
  row: number;
  businessName: string;
  phoneNumber: string;
  category: string;
  city: string;
  message: string;
  templateName: string;
  templateVariables: string[];
  consentStatus: MarketingConsentStatus;
  consentSource: string;
  consentDate: string;
};

export type PersonalizedEligibility =
  | "Ready to Send"
  | "Template Required"
  | "Missing Consent"
  | "Invalid Number"
  | "Missing Variable"
  | "Opted Out"
  | "Duplicate Contact"
  | "Suppressed"
  | "Excluded";

export type InspectedPersonalizedRow = PersonalizedCsvRow & {
  normalizedPhoneNumber: string;
  contactId: Types.ObjectId | null;
  categoryId: Types.ObjectId | null;
  categoryName: string;
  effectiveConsentStatus: MarketingConsentStatus;
  renderedMessage: string;
  eligibilityStatus: PersonalizedEligibility;
  exclusionReason: string;
  eligible: boolean;
};

type TemplateSnapshot = {
  _id: Types.ObjectId;
  name: string;
  body: string;
  header: string;
  footer: string;
  variables: number[];
};

function text(value: unknown, max: number, preserve = false) {
  if (typeof value !== "string") return "";
  const result = preserve ? value : value.trim();
  return result.length <= max ? result : result.slice(0, max + 1);
}

export function normalizeImportedConsent(value: unknown): MarketingConsentStatus {
  if (typeof value !== "string") return "Unknown";
  const normalized = value.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "optedin") return "Opted In";
  if (normalized === "optedout") return "Opted Out";
  return "Unknown";
}

export function parsePersonalizedRows(value: unknown):
  | { ok: true; rows: PersonalizedCsvRow[] }
  | { ok: false; message: string } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5000) {
    return { ok: false, message: "Provide between 1 and 5,000 CSV rows." };
  }
  const rows: PersonalizedCsvRow[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, message: `CSV row ${index + 2} is invalid.` };
    }
    const item = raw as Record<string, unknown>;
    const variables = Array.isArray(item.templateVariables)
      ? item.templateVariables.slice(0, 20).map((entry) => text(entry, 1024, true))
      : [item.templateVariable1, item.templateVariable2, item.templateVariable3].map((entry) => text(entry, 1024, true));
    rows.push({
      row: Number.isInteger(item.row) && Number(item.row) >= 2 ? Number(item.row) : index + 2,
      businessName: text(item.businessName, 160),
      phoneNumber: text(item.phoneNumber, 40),
      category: text(item.category, 160),
      city: text(item.city, 100),
      message: text(item.message, 4096, true),
      templateName: text(item.templateName, 512),
      templateVariables: variables,
      consentStatus: normalizeImportedConsent(item.consentStatus),
      consentSource: text(item.consentSource, 120),
      consentDate: text(item.consentDate, 100)
    });
  }
  return { ok: true, rows };
}

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function renderApprovedTemplate(body: string, variables: string[]) {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) => variables[Number(number) - 1] ?? "");
}

export function hasActiveCustomerServiceWindow(lastIncoming: Date | null | undefined, now = Date.now()) {
  return lastIncoming instanceof Date &&
    !Number.isNaN(lastIncoming.getTime()) &&
    now >= lastIncoming.getTime() &&
    now - lastIncoming.getTime() < 24 * 60 * 60 * 1000;
}

export function hasRequiredTemplateVariables(body: string, variables: string[]) {
  return extractTemplateVariables(body).every((number) => Boolean(variables[number - 1]?.trim()));
}

function documentedConsent(status: MarketingConsentStatus, source: string, date: string | Date | null | undefined) {
  if (status !== "Opted In" || !source.trim() || !date) return false;
  const parsed = date instanceof Date ? date : new Date(date);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
}

export async function inspectPersonalizedRows(
  rows: PersonalizedCsvRow[],
  mode: PersonalizedMode,
  templateId = ""
) {
  const categories = await Category.find().select("name").lean();
  const categoryById = new Map(categories.map((item) => [String(item._id), item]));
  const normalizedCategories = categories.map((item) => ({ item, key: normalizedName(item.name) }));
  const normalizedNumbers = rows.map((row) => normalizePhoneNumber(row.phoneNumber)).filter((phone): phone is string => Boolean(phone));
  const [contacts, suppressions, conversations, templateRecord] = await Promise.all([
    Contact.find({ phoneNumber: { $in: normalizedNumbers } })
      .select("businessName phoneNumber categoryId city marketingConsentStatus consentSource consentTimestamp")
      .lean(),
    MessageSuppression.find({ phoneNumber: { $in: normalizedNumbers } }).select("phoneNumber").lean(),
    Conversation.find({ phoneNumber: { $in: normalizedNumbers } }).select("phoneNumber lastIncomingMessageAt").lean(),
    mode === "approved_template" && Types.ObjectId.isValid(templateId)
      ? MessageTemplate.findOne({ _id: templateId, isDraft: false, metaStatus: "APPROVED", metaTemplateId: { $ne: "" } })
          .select("name body header footer variables")
          .lean()
      : null
  ]);
  const template = templateRecord ? {
    _id: templateRecord._id,
    name: templateRecord.name,
    body: templateRecord.body,
    header: templateRecord.header,
    footer: templateRecord.footer,
    variables: extractTemplateVariables(templateRecord.body)
  } satisfies TemplateSnapshot : null;
  const contactsByPhone = new Map(contacts.map((item) => [item.phoneNumber, item]));
  const suppressed = new Set(suppressions.map((item) => item.phoneNumber));
  const incomingByPhone = new Map(conversations.map((item) => [item.phoneNumber, item.lastIncomingMessageAt]));
  const seen = new Set<string>();
  const inspected: InspectedPersonalizedRow[] = [];

  for (const row of rows) {
    const phone = normalizePhoneNumber(row.phoneNumber) ?? "";
    const existing = phone ? contactsByPhone.get(phone) : undefined;
    const requestedCategory = normalizedName(row.category);
    const categoryMatches = requestedCategory
      ? normalizedCategories.filter(({ key }) => key === requestedCategory || key.includes(requestedCategory) || requestedCategory.includes(key))
      : [];
    const category = categoryMatches.length === 1
      ? categoryMatches[0].item
      : existing ? categoryById.get(String(existing.categoryId)) ?? null : null;
    const existingStatus = existing?.marketingConsentStatus as MarketingConsentStatus | undefined;
    const existingConsentValid = existing
      ? documentedConsent(existingStatus ?? "Unknown", existing.consentSource ?? "", existing.consentTimestamp)
      : false;
    const csvConsentValid = documentedConsent(row.consentStatus, row.consentSource, row.consentDate);
    const effectiveConsentStatus: MarketingConsentStatus = existingStatus === "Opted Out"
      ? "Opted Out"
      : row.consentStatus === "Opted Out"
        ? "Opted Out"
        : existingConsentValid
          ? "Opted In"
          : csvConsentValid ? "Opted In" : "Unknown";
    const consentValid = effectiveConsentStatus === "Opted In" && (existingConsentValid || csvConsentValid);
    const duplicate = Boolean(phone && seen.has(phone));
    if (phone && !duplicate) seen.add(phone);
    const variables = row.templateVariables;
    const renderedMessage = mode === "personalized_csv"
      ? row.message
      : template ? [template.header, renderApprovedTemplate(template.body, variables), template.footer].filter(Boolean).join("\n\n") : "";
    let eligibilityStatus: PersonalizedEligibility = "Ready to Send";
    let exclusionReason = "";

    if (!phone) {
      eligibilityStatus = "Invalid Number";
      exclusionReason = "Enter a valid WhatsApp number, including the country code when needed.";
    } else if (duplicate) {
      eligibilityStatus = "Duplicate Contact";
      exclusionReason = "This WhatsApp number already appears earlier in the uploaded CSV.";
    } else if (!row.businessName) {
      eligibilityStatus = "Excluded";
      exclusionReason = "Business Name is required.";
    } else if (!category) {
      eligibilityStatus = "Excluded";
      exclusionReason = row.category ? "Category could not be matched uniquely to an existing category." : "Category is required.";
    } else if (effectiveConsentStatus === "Opted Out") {
      eligibilityStatus = "Opted Out";
      exclusionReason = "The contact is opted out of marketing messages.";
    } else if (!consentValid) {
      eligibilityStatus = "Missing Consent";
      exclusionReason = "Current documented opt-in, consent source, and a non-future consent date are required.";
    } else if (suppressed.has(phone)) {
      eligibilityStatus = "Suppressed";
      exclusionReason = "The number is on the message suppression list.";
    } else if (mode === "personalized_csv") {
      if (!row.message.trim() || row.message.length > 4096) {
        eligibilityStatus = "Excluded";
        exclusionReason = "A personalized message between 1 and 4,096 characters is required.";
      } else {
        const lastIncoming = incomingByPhone.get(phone);
        const withinWindow = hasActiveCustomerServiceWindow(lastIncoming);
        if (!withinWindow) {
          eligibilityStatus = "Template Required";
          exclusionReason = "The 24-hour customer service window is closed; use an approved template instead.";
        }
      }
    } else if (!template) {
      eligibilityStatus = "Excluded";
      exclusionReason = "Choose a currently approved Meta template.";
    } else if (row.templateName && row.templateName.toLowerCase() !== template.name.toLowerCase()) {
      eligibilityStatus = "Excluded";
      exclusionReason = `CSV template name does not match the selected approved template (${template.name}).`;
    } else if (!hasRequiredTemplateVariables(template.body, variables)) {
      eligibilityStatus = "Missing Variable";
      exclusionReason = "One or more required approved-template variables are missing.";
    }

    inspected.push({
      ...row,
      normalizedPhoneNumber: phone,
      contactId: existing?._id ?? null,
      categoryId: category?._id ?? null,
      categoryName: category?.name ?? row.category,
      effectiveConsentStatus,
      renderedMessage,
      eligibilityStatus,
      exclusionReason,
      eligible: eligibilityStatus === "Ready to Send"
    });
  }

  return {
    rows: inspected,
    template,
    summary: {
      totalRows: inspected.length,
      validContacts: inspected.filter((row) => row.normalizedPhoneNumber).length,
      personalizedMessages: inspected.filter((row) => row.message.trim()).length,
      duplicateContacts: inspected.filter((row) => row.eligibilityStatus === "Duplicate Contact").length,
      invalidRows: inspected.filter((row) => ["Invalid Number", "Excluded"].includes(row.eligibilityStatus)).length,
      contactsWithoutRequiredConsent: inspected.filter((row) => ["Missing Consent", "Opted Out"].includes(row.eligibilityStatus)).length,
      eligibleContacts: inspected.filter((row) => row.eligible).length,
      excludedContacts: inspected.filter((row) => !row.eligible).length
    }
  };
}
