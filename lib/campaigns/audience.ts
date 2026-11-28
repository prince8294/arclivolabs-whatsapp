import { Types } from "mongoose";
import { hasCurrentDocumentedMarketingConsent, normalizePhoneNumber } from "@/lib/contacts/validation";
import Contact from "@/lib/models/contact";
import Category from "@/lib/models/category";
import MessageSuppression from "@/lib/models/message-suppression";
import { extractTemplateVariables } from "@/lib/templates/validation";
import { findRecordedRecipients } from "@/lib/campaigns/reservations";

export type CampaignVariableMapping = {
  number: number;
  mapping: "contactPerson" | "businessName" | "city";
};

export type AudienceOptions = {
  categoryIds: string[];
  cities: string[];
  variableMappings: CampaignVariableMapping[];
  body: string;
  variableNumbers?: number[];
  campaignId?: string;
};

export type EligibleRecipient = {
  contactId: Types.ObjectId;
  phoneNumber: string;
  businessName: string;
  contactPerson: string;
  categoryId: Types.ObjectId;
  categoryName: string;
  city: string;
  templateVariables: string[];
};

export type AudienceBatch = {
  matchingCount: number;
  eligible: EligibleRecipient[];
  excludedCount: number;
  excluded: (Omit<EligibleRecipient, "templateVariables"> & { errorCode: string; errorMessage: string })[];
};

function mappedValue(contact: {
  contactPerson?: string;
  businessName?: string;
  city?: string;
}, mapping: CampaignVariableMapping["mapping"]) {
  if (mapping === "contactPerson") return contact.contactPerson?.trim() ?? "";
  if (mapping === "businessName") return contact.businessName?.trim() ?? "";
  return contact.city?.trim() ?? "";
}

export async function* scanAudience(options: AudienceOptions, batchSize = 400): AsyncGenerator<AudienceBatch> {
  const filter: Record<string, unknown> = {
    categoryId: { $in: options.categoryIds.map((id) => new Types.ObjectId(id)) }
  };
  if (options.cities.length) filter.city = { $in: options.cities };
  const categories = await Category.find({ _id: { $in: options.categoryIds } }).select("name").lean();
  const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));
  const variables = options.variableNumbers ?? extractTemplateVariables(options.body);
  const mappings = new Map(options.variableMappings.map((item) => [item.number, item.mapping]));
  const seenPhoneNumbers = new Set<string>();
  const cursor = Contact.find(filter)
    .select("businessName contactPerson phoneNumber categoryId city marketingConsentStatus consentSource consentTimestamp doNotContact")
    .sort({ _id: 1 })
    .lean()
    .cursor();
  let batch: Awaited<ReturnType<typeof cursor.next>>[] = [];

  async function evaluate(rows: Awaited<ReturnType<typeof cursor.next>>[]): Promise<AudienceBatch> {
    const normalizedNumbers = rows.map((contact) => contact ? normalizePhoneNumber(contact.phoneNumber) : null).filter((phone): phone is string => Boolean(phone));
    const [suppressionRecords, recorded] = await Promise.all([
      MessageSuppression.find({ phoneNumber: { $in: normalizedNumbers } }).select("phoneNumber").lean(),
      findRecordedRecipients(
        normalizedNumbers,
        options.campaignId && Types.ObjectId.isValid(options.campaignId) ? new Types.ObjectId(options.campaignId) : undefined
      )
    ]);
    const suppressed = new Set(suppressionRecords.map((item) => item.phoneNumber));
    for (const contact of rows) {
      if (contact?.marketingConsentStatus === "Opted Out") {
        const optedOutPhone = normalizePhoneNumber(contact.phoneNumber);
        if (optedOutPhone) suppressed.add(optedOutPhone);
      }
    }
    const eligible: EligibleRecipient[] = [];
    const excluded: AudienceBatch["excluded"] = [];
    let excludedCount = 0;
    for (const contact of rows) {
      if (!contact) continue;
      const phoneNumber = normalizePhoneNumber(contact.phoneNumber);
      const snapshot = {
        contactId: contact._id,
        phoneNumber: phoneNumber ?? contact.phoneNumber,
        businessName: contact.businessName,
        contactPerson: contact.contactPerson ?? "",
        categoryId: contact.categoryId,
        categoryName: categoryNames.get(String(contact.categoryId)) ?? "",
        city: contact.city ?? ""
      };
      const validConsent = hasCurrentDocumentedMarketingConsent(contact);
      let errorCode = "";
      let errorMessage = "";
      if (!validConsent) {
        errorCode = "CONSENT_NOT_DOCUMENTED";
        errorMessage = "Contact does not have current documented marketing opt-in.";
      } else if (!phoneNumber) {
        errorCode = "INVALID_WHATSAPP_NUMBER";
        errorMessage = "Contact does not have a valid WhatsApp number.";
      } else if (suppressed.has(phoneNumber)) {
        errorCode = "SUPPRESSED";
        errorMessage = "Contact number is on the suppression list.";
      } else if (contact.doNotContact) {
        errorCode = "SUPPRESSED";
        errorMessage = "Contact is marked Do Not Contact.";
      } else if (recorded.has(phoneNumber)) {
        errorCode = "DUPLICATE_PHONE";
        errorMessage = `Recipient already recorded in campaign ${recorded.get(phoneNumber)?.campaignId ?? "history"}.`;
      } else if (seenPhoneNumbers.has(phoneNumber)) {
        errorCode = "DUPLICATE_PHONE";
        errorMessage = "Duplicate WhatsApp number excluded from this campaign.";
      }
      if (errorCode) {
        excludedCount += 1;
        excluded.push({ ...snapshot, errorCode, errorMessage });
        continue;
      }
      const templateVariables = variables.map((number) => {
        const mapping = mappings.get(number);
        return mapping ? mappedValue(contact, mapping) : "";
      });
      if (templateVariables.some((value) => !value)) {
        excludedCount += 1;
        excluded.push({
          ...snapshot,
          errorCode: "MISSING_TEMPLATE_VARIABLE",
          errorMessage: "A required template variable has no value for this contact."
        });
        continue;
      }
      if (!phoneNumber) continue;
      seenPhoneNumbers.add(phoneNumber);
      eligible.push({
        ...snapshot,
        templateVariables
      });
    }
    return { matchingCount: rows.length, eligible, excludedCount, excluded };
  }

  for await (const contact of cursor) {
    batch.push(contact);
    if (batch.length >= batchSize) {
      yield await evaluate(batch);
      batch = [];
    }
  }
  if (batch.length) yield await evaluate(batch);
}

export async function summarizeAudience(options: AudienceOptions, previewLimit = 50) {
  let matchingContacts = 0;
  let eligibleContacts = 0;
  let excludedContacts = 0;
  const recipients: EligibleRecipient[] = [];
  for await (const batch of scanAudience(options)) {
    matchingContacts += batch.matchingCount;
    eligibleContacts += batch.eligible.length;
    excludedContacts += batch.excludedCount;
    if (recipients.length < previewLimit) {
      recipients.push(...batch.eligible.slice(0, previewLimit - recipients.length));
    }
  }
  return { matchingContacts, eligibleContacts, excludedContacts, recipients };
}

export function campaignFilterIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 100) return null;
  if (value.some((item) => typeof item !== "string" || !Types.ObjectId.isValid(item))) return null;
  return [...new Set(value as string[])];
}
