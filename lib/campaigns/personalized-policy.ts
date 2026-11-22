import { normalizePhoneNumber, type MarketingConsentStatus } from "@/lib/contacts/validation";

export type PersonalizedPolicyRow = {
  row: number;
  businessName: string;
  phoneNumber: string;
  category: string;
  city: string;
  recommendedSolution: string;
  businessBenefit: string;
  templateVariables: string[];
  consentStatus: MarketingConsentStatus;
  consentSource: string;
  consentDate: string;
};

export type PersonalizedPolicyContact = {
  _id: { toString(): string };
  businessName: string;
  phoneNumber: string;
  categoryId: { toString(): string };
  city: string;
  marketingConsentStatus: MarketingConsentStatus;
  consentSource?: string;
  consentTimestamp?: Date | null;
  doNotContact?: boolean;
};

export type PersonalizedPolicyTemplate = {
  _id: { toString(): string };
  name: string;
  language: string;
  body: string;
  header: string;
  headerFormat?: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  headerMediaUrl?: string;
  footer: string;
  buttons: { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[];
  variables: number[];
};

export type PersonalizedPolicyCategory = { id: string; name: string };
export type RecordedRecipient = { type: string; campaignId: string; recordId: string };

export type InspectedPolicyRow = PersonalizedPolicyRow & {
  normalizedPhoneNumber: string;
  contactId: string;
  categoryId: string;
  categoryName: string;
  effectiveConsentStatus: MarketingConsentStatus;
  renderedMessage: string;
  eligibilityStatus: string;
  exclusionReason: string;
  duplicateType: string;
  duplicateCampaignId: string;
  duplicateRecordId: string;
  eligible: boolean;
};

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function documentedConsent(contact: PersonalizedPolicyContact | undefined, now: number) {
  return Boolean(
    contact &&
    contact.marketingConsentStatus === "Opted In" &&
    contact.consentSource?.trim() &&
    contact.consentTimestamp instanceof Date &&
    !Number.isNaN(contact.consentTimestamp.getTime()) &&
    contact.consentTimestamp.getTime() <= now
  );
}

export function renderApprovedTemplate(body: string, variables: string[]) {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) => variables[Number(number) - 1] ?? "");
}

export function evaluatePersonalizedRows(
  rows: PersonalizedPolicyRow[],
  category: PersonalizedPolicyCategory,
  template: PersonalizedPolicyTemplate | null,
  contactsByPhone: Map<string, PersonalizedPolicyContact>,
  suppressions: Set<string>,
  recorded: Map<string, RecordedRecipient>,
  now = Date.now()
) {
  const seen = new Map<string, number>();
  const inspected: InspectedPolicyRow[] = [];
  const categoryKey = normalizedName(category.name);

  for (const row of rows) {
    const phone = normalizePhoneNumber(row.phoneNumber) ?? "";
    const existing = phone ? contactsByPhone.get(phone) : undefined;
    const rowCategoryKey = normalizedName(row.category);
    const existingCategoryMatches = existing?.categoryId.toString() === category.id;
    const rowCategoryMatches = !rowCategoryKey || rowCategoryKey === categoryKey;
    const duplicateRow = phone ? seen.get(phone) : undefined;
    const duplicate = duplicateRow !== undefined;
    const prior = phone ? recorded.get(phone) : undefined;
    const consent = documentedConsent(existing, now);
    const variables = [
      row.businessName.trim(),
      row.recommendedSolution.trim(),
      row.businessBenefit.trim(),
      ...row.templateVariables.slice(3).map((value) => value.trim())
    ];
    const usedVariables = template?.variables ?? [];
    const renderedBody = template ? renderApprovedTemplate(template.body, variables) : "";
    const renderedHeader = template ? renderApprovedTemplate(template.header, variables) : "";
    const renderedButtons = template?.buttons.map((button) =>
      `${button.text}${button.url ? ` · ${renderApprovedTemplate(button.url, variables)}` : ""}`
    ) ?? [];
    const renderedMessage = [renderedHeader, renderedBody, template?.footer ?? "", ...renderedButtons].filter(Boolean).join("\n\n");
    let eligibilityStatus = "Ready to Send";
    let exclusionReason = "";
    let duplicateType = "";
    let duplicateCampaignId = "";
    let duplicateRecordId = "";

    if (!phone) {
      eligibilityStatus = "Invalid Number";
      exclusionReason = "Enter a valid WhatsApp number, including the country code when needed.";
    } else if (duplicate) {
      eligibilityStatus = "Duplicate Contact";
      exclusionReason = "This is a repeated valid recipient in the uploaded CSV; the first eligible row is retained.";
      duplicateType = "within_csv";
      duplicateRecordId = String(duplicateRow);
    } else if (prior) {
      eligibilityStatus = "Duplicate Contact";
      exclusionReason = prior.type === "previous_message"
        ? "This number already has an outgoing WhatsApp message recorded."
        : "This number was already imported, reserved, or recorded in a prior campaign.";
      duplicateType = prior.type;
      duplicateCampaignId = prior.campaignId;
      duplicateRecordId = prior.recordId;
    } else if (!row.businessName.trim()) {
      eligibilityStatus = "Missing Variable";
      exclusionReason = "Business Name is required for the approved template.";
    } else if (!rowCategoryMatches || (existing && !existingCategoryMatches)) {
      eligibilityStatus = "Wrong Category";
      exclusionReason = `This row must belong to the selected ${category.name} category.`;
    } else if (!existing || !consent) {
      eligibilityStatus = existing?.marketingConsentStatus === "Opted Out" ? "Opted Out" : "Missing Consent";
      exclusionReason = existing
        ? "Stored, current, documented marketing opt-in is required; CSV consent claims are not accepted."
        : "A matching CRM contact with stored, documented marketing opt-in is required.";
    } else if (existing.doNotContact || suppressions.has(phone)) {
      eligibilityStatus = existing.doNotContact ? "Suppressed" : existing.marketingConsentStatus === "Opted Out" ? "Opted Out" : "Suppressed";
      exclusionReason = existing.doNotContact
        ? "This CRM contact is marked Do Not Contact."
        : "This number is opted out or on the permanent suppression list.";
    } else if (!template) {
      eligibilityStatus = "Excluded";
      exclusionReason = "Choose a currently approved Meta marketing template.";
    } else if (usedVariables.some((number) => !variables[number - 1]?.trim())) {
      eligibilityStatus = "Missing Variable";
      exclusionReason = "One or more required approved-template variables are missing.";
    } else {
      seen.set(phone, row.row);
    }

    inspected.push({
      ...row,
      normalizedPhoneNumber: phone,
      contactId: existing?._id.toString() ?? "",
      categoryId: category.id,
      categoryName: category.name,
      effectiveConsentStatus: existing?.marketingConsentStatus ?? "Unknown",
      renderedMessage,
      eligibilityStatus,
      exclusionReason,
      duplicateType,
      duplicateCampaignId,
      duplicateRecordId,
      eligible: eligibilityStatus === "Ready to Send"
    });
  }

  const uniqueNumbers = new Set(inspected.map((row) => row.normalizedPhoneNumber).filter(Boolean));
  const duplicateRows = inspected.filter((row) => row.eligibilityStatus === "Duplicate Contact");
  return {
    rows: inspected,
    summary: {
      totalRows: inspected.length,
      uniqueNumbers: uniqueNumbers.size,
      duplicateWithinCsv: duplicateRows.filter((row) => row.duplicateType === "within_csv").length,
      previouslyImportedOrContacted: duplicateRows.filter((row) => row.duplicateType !== "within_csv").length,
      invalidNumbers: inspected.filter((row) => row.eligibilityStatus === "Invalid Number").length,
      missingTemplateData: inspected.filter((row) => row.eligibilityStatus === "Missing Variable").length,
      noConsentOrOptedOut: inspected.filter((row) => ["Missing Consent", "Opted Out", "Suppressed"].includes(row.eligibilityStatus)).length,
      wrongCategory: inspected.filter((row) => row.eligibilityStatus === "Wrong Category").length,
      eligibleContacts: inspected.filter((row) => row.eligible).length,
      excludedContacts: inspected.filter((row) => !row.eligible).length
    }
  };
}
