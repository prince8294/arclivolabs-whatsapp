import { Types } from "mongoose";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";
import MessageSuppression from "@/lib/models/message-suppression";
import MessageTemplate from "@/lib/models/message-template";
import { normalizePhoneNumber, type MarketingConsentStatus } from "@/lib/contacts/validation";
import {
  evaluatePersonalizedRows,
  renderApprovedTemplate,
  type InspectedPolicyRow,
  type PersonalizedPolicyRow,
  type PersonalizedPolicyTemplate
} from "@/lib/campaigns/personalized-policy";
import { findRecordedRecipients } from "@/lib/campaigns/reservations";
import { extractTemplateVariables } from "@/lib/templates/validation";

export const personalizedModes = ["personalized_csv", "approved_template"] as const;
export type PersonalizedMode = (typeof personalizedModes)[number];

export type PersonalizedCsvRow = PersonalizedPolicyRow & {
  message: string;
  templateName: string;
};

export type PersonalizedEligibility =
  | "Ready to Send"
  | "Missing Consent"
  | "Invalid Number"
  | "Missing Variable"
  | "Opted Out"
  | "Duplicate Contact"
  | "Suppressed"
  | "Wrong Category"
  | "Excluded";

export type InspectedPersonalizedRow = Omit<InspectedPolicyRow, "contactId"> & {
  contactId: Types.ObjectId | null;
};

function text(value: unknown, max: number, preserve = false) {
  if (typeof value !== "string") return "";
  const result = preserve ? value : value.trim();
  return result.length <= max ? result : result.slice(0, max + 1);
}

function valueFor(item: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (item[key] !== undefined) return item[key];
  }
  return undefined;
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
    const businessName = text(valueFor(item, "businessName", "business_name", "company_name", "companyName", "name"), 160);
    const recommendedSolution = text(valueFor(item, "recommendedSolution", "recommended_solution", "solution", "recommendation"), 1024);
    const businessBenefit = text(valueFor(item, "businessBenefit", "business_benefit", "benefit"), 1024);
    const suppliedVariables = Array.isArray(item.templateVariables)
      ? item.templateVariables.slice(0, 20).map((entry) => text(entry, 1024, true))
      : [];
    const templateVariables = [
      businessName,
      recommendedSolution,
      businessBenefit,
      ...suppliedVariables.slice(3)
    ];
    rows.push({
      row: Number.isInteger(item.row) && Number(item.row) >= 2 ? Number(item.row) : index + 2,
      businessName,
      phoneNumber: text(valueFor(item, "phoneNumber", "phone", "mobile", "number", "whatsappNumber"), 40),
      category: text(valueFor(item, "category", "businessCategory", "industry"), 160),
      city: text(item.city, 100),
      recommendedSolution,
      businessBenefit,
      templateVariables,
      consentStatus: normalizeImportedConsent(valueFor(item, "consentStatus", "consent_status", "marketingConsentStatus")),
      consentSource: text(valueFor(item, "consentSource", "consent_source"), 120),
      consentDate: text(valueFor(item, "consentDate", "consentTimestamp", "consent_timestamp"), 100),
      message: text(item.message, 4096, true),
      templateName: text(item.templateName, 512)
    });
  }
  return { ok: true, rows };
}

export { renderApprovedTemplate };

export function hasActiveCustomerServiceWindow(lastIncoming: Date | null | undefined, now = Date.now()) {
  return lastIncoming instanceof Date &&
    !Number.isNaN(lastIncoming.getTime()) &&
    now >= lastIncoming.getTime() &&
    now - lastIncoming.getTime() < 24 * 60 * 60 * 1000;
}

export function hasRequiredTemplateVariables(body: string, variables: string[]) {
  return extractTemplateVariables(body).every((number) => Boolean(variables[number - 1]?.trim()));
}

function templateVariableNumbers(template: {
  body: string;
  header: string;
  buttons: { url?: string }[];
}) {
  const values = [template.header, template.body, ...template.buttons.map((button) => button.url ?? "")];
  return [...new Set(values.flatMap((value) => extractTemplateVariables(value)))].sort((a, b) => a - b);
}

export async function inspectPersonalizedRows(
  rows: PersonalizedCsvRow[],
  mode: PersonalizedMode,
  templateId = "",
  selectedCategoryId = ""
) {
  const categoryRecord = Types.ObjectId.isValid(selectedCategoryId)
    ? await Category.findById(selectedCategoryId).select("name").lean()
    : null;
  const category = categoryRecord
    ? { id: String(categoryRecord._id), name: categoryRecord.name }
    : { id: "", name: "" };
  const normalizedNumbers = rows
    .map((row) => normalizePhoneNumber(row.phoneNumber))
    .filter((phone): phone is string => Boolean(phone));
  const [contacts, suppressions, templateRecord, recorded] = await Promise.all([
    Contact.find({ phoneNumber: { $in: normalizedNumbers } })
      .select("businessName phoneNumber categoryId city marketingConsentStatus consentSource consentTimestamp doNotContact")
      .lean(),
    MessageSuppression.find({ phoneNumber: { $in: normalizedNumbers } }).select("phoneNumber").lean(),
    mode === "approved_template" && Types.ObjectId.isValid(templateId)
      ? MessageTemplate.findOne({
          _id: templateId,
          isDraft: false,
          metaStatus: "APPROVED",
          metaCategory: "MARKETING",
          metaTemplateId: { $ne: "" }
        }).select("name language body header footer buttons").lean()
      : null,
    findRecordedRecipients(normalizedNumbers)
  ]);
  const template: PersonalizedPolicyTemplate | null = templateRecord ? {
    _id: templateRecord._id,
    name: templateRecord.name,
    language: templateRecord.language,
    body: templateRecord.body,
    header: templateRecord.header,
    footer: templateRecord.footer,
    buttons: templateRecord.buttons.map((button) => ({
      type: button.type,
      text: button.text,
      ...(button.url ? { url: button.url } : {})
    })),
    variables: templateVariableNumbers({
      body: templateRecord.body,
      header: templateRecord.header,
      buttons: templateRecord.buttons
    })
  } : null;

  const contactByPhone = new Map(contacts.map((contact) => [contact.phoneNumber, contact]));
  const policyRows = evaluatePersonalizedRows(
    rows,
    category,
    template,
    contactByPhone,
    new Set(suppressions.map((item) => item.phoneNumber)),
    recorded
  );
  return {
    ...policyRows,
    template,
    rows: policyRows.rows.map((row) => ({
      ...row,
      contactId: row.contactId && Types.ObjectId.isValid(row.contactId) ? new Types.ObjectId(row.contactId) : null
    }))
  };
}
