import type { MarketingConsentStatus } from "@/lib/contacts/validation";
import { validateConsentInput, validateContactProfile } from "@/lib/contacts/validation";
import type { ContactProfileInput, ConsentInput } from "@/lib/contacts/validation";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";

export type ImportRowResult = {
  row: number;
  businessName: string;
  phoneNumber: string;
  status: "ready" | "update" | "duplicate" | "invalid" | "excluded";
  errors: string[];
  preserveExistingOptOut?: boolean;
  profile?: ContactProfileInput;
  consent?: ConsentInput;
};

export async function inspectImportRows(rows: unknown[], updateExisting: boolean) {
  const results: ImportRowResult[] = [];
  const seenNumbers = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      results.push({ row: index + 2, businessName: "", phoneNumber: "", status: "invalid", errors: ["Row must be an object."] });
      continue;
    }

    const values = raw as Record<string, unknown>;
    const businessName = typeof values.businessName === "string" ? values.businessName.trim() : "";
    if (values.excluded === true) {
      results.push({ row: index + 2, businessName, phoneNumber: "", status: "excluded", errors: [] });
      continue;
    }

    const profile = validateContactProfile(values);
    if (!profile.ok) {
      results.push({ row: index + 2, businessName, phoneNumber: "", status: "invalid", errors: [profile.message] });
      continue;
    }

    const consent = validateConsentInput(values);
    if (!consent.ok) {
      results.push({
        row: index + 2,
        businessName: profile.value.businessName,
        phoneNumber: profile.value.phoneNumber,
        status: "invalid",
        errors: [consent.message]
      });
      continue;
    }

    const number = profile.value.phoneNumber;
    if (seenNumbers.has(number)) {
      results.push({
        row: index + 2,
        businessName: profile.value.businessName,
        phoneNumber: number,
        status: "duplicate",
        errors: ["This phone number already appears earlier in the uploaded CSV."]
      });
      continue;
    }
    seenNumbers.add(number);
    results.push({
      row: index + 2,
      businessName: profile.value.businessName,
      phoneNumber: number,
      status: "ready",
      errors: [],
      profile: profile.value,
      consent: consent.value
    });
  }

  const categoryIds = results
    .filter((result) => result.profile)
    .map((result) => result.profile!.categoryId);
  const categories = await Category.find({ _id: { $in: categoryIds } }).select("_id").lean();
  const existingCategoryIds = new Set(categories.map((category) => category._id.toString()));
  for (const result of results) {
    if (result.profile && !existingCategoryIds.has(result.profile.categoryId.toString())) {
      result.status = "invalid";
      result.errors.push("Selected category was not found.");
      delete result.profile;
      delete result.consent;
    }
  }

  const candidates = results.filter((result) => result.profile);
  const existing = await Contact.find({ phoneNumber: { $in: candidates.map((row) => row.phoneNumber) } })
    .select("phoneNumber marketingConsentStatus")
    .lean();
  const existingByNumber = new Map(
    existing.map((contact) => [contact.phoneNumber, contact.marketingConsentStatus as MarketingConsentStatus])
  );

  for (const result of candidates) {
    const existingStatus = existingByNumber.get(result.phoneNumber);
    if (existingStatus) {
      if (existingStatus === "Opted Out" && result.consent?.status === "Opted In") {
        result.status = "invalid";
        result.errors = ["This contact is already opted out. Imports cannot replace its consent status or history."];
        delete result.profile;
        delete result.consent;
        continue;
      }
      result.status = updateExisting ? "update" : "duplicate";
      result.preserveExistingOptOut = existingStatus === "Opted Out";
      if (!updateExisting) {
        result.errors = ["A contact with this number already exists."];
        delete result.profile;
        delete result.consent;
      }
    }
  }

  return results;
}

export function summarizeImportRows(rows: ImportRowResult[]) {
  const validContacts = rows.filter((row) => row.status !== "invalid" && row.status !== "excluded").length;
  const duplicateContacts = rows.filter((row) => row.status === "duplicate").length;
  const invalidContacts = rows.filter((row) => row.status === "invalid").length;
  const readyContacts = rows.filter((row) => row.status === "ready" || row.status === "update").length;
  return {
    totalRows: rows.length,
    validContacts,
    duplicateContacts,
    invalidContacts,
    excludedRows: rows.filter((row) => row.status === "excluded").length,
    readyContacts
  };
}

export async function writeImportRows(rows: ImportRowResult[], updateExisting: boolean) {
  const successful: ImportRowResult[] = [];
  const skipped: ImportRowResult[] = [];
  const updated: ImportRowResult[] = [];
  const failed: ImportRowResult[] = [];
  const eligible = rows.filter((row) => row.status === "ready" || row.status === "update");

  for (let start = 0; start < eligible.length; start += 200) {
    const batch = eligible.slice(start, start + 200);
    const operations: Array<{
      updateOne: {
        filter: { phoneNumber: string };
        update: Record<string, unknown>;
        upsert?: boolean;
      };
    }> = [];
    const operationRows: ImportRowResult[] = [];

    for (const row of batch) {
      if (!row.profile || !row.consent) continue;
      const { categoryId, ...profile } = row.profile;
      if (row.status === "update" && updateExisting) {
        const setFields: Record<string, unknown> = { ...profile, categoryId };
        const update: Record<string, unknown> = { $set: setFields };
        if (row.consent.status !== "Unknown" && !row.preserveExistingOptOut) {
          Object.assign(setFields, {
            marketingConsentStatus: row.consent.status,
            consentSource: row.consent.source,
            consentTimestamp: row.consent.timestamp
          });
          update.$addToSet = {
            consentHistory: {
              status: row.consent.status,
              source: row.consent.source,
              timestamp: row.consent.timestamp
            }
          };
        }
        operations.push({
          updateOne: {
            filter: { phoneNumber: row.phoneNumber },
            update
          }
        });
        operationRows.push(row);
      } else {
        const consentHistory =
          row.consent.status === "Unknown"
            ? []
            : [{ status: row.consent.status, source: row.consent.source, timestamp: row.consent.timestamp }];
        operations.push({
          updateOne: {
            filter: { phoneNumber: row.phoneNumber },
            update: {
              $setOnInsert: {
                ...profile,
                categoryId,
                phoneNumber: row.phoneNumber,
                marketingConsentStatus: row.consent.status,
                consentSource: row.consent.source,
                consentTimestamp: row.consent.timestamp,
                consentHistory
              }
            },
            upsert: true
          }
        });
        operationRows.push(row);
      }
    }

    try {
      const result = await Contact.bulkWrite(operations, { ordered: false });
      const insertedIndices = new Set(Object.keys(result.upsertedIds).map(Number));
      operationRows.forEach((row, index) => {
        if (row.status === "update" && updateExisting) updated.push(row);
        else if (insertedIndices.has(index)) successful.push(row);
        else skipped.push({ ...row, status: "duplicate", errors: ["A contact with this number already exists."] });
      });
    } catch (error) {
      const errorRecord = error && typeof error === "object" ? error as Record<string, unknown> : null;
      const writeErrors = errorRecord && Array.isArray(errorRecord.writeErrors) ? errorRecord.writeErrors : [];
      const resultRecord =
        errorRecord?.result && typeof errorRecord.result === "object"
          ? errorRecord.result as Record<string, unknown>
          : null;
      const upsertedIds =
        resultRecord?.upsertedIds && typeof resultRecord.upsertedIds === "object"
          ? resultRecord.upsertedIds as Record<string, unknown>
          : {};
      const insertedIndices = new Set(Object.keys(upsertedIds).map(Number));
      const errorIndices = new Map<number, string>();
      for (const writeError of writeErrors) {
        if (
          writeError &&
          typeof writeError === "object" &&
          "index" in writeError &&
          typeof writeError.index === "number"
        ) {
          const code = "code" in writeError ? writeError.code : undefined;
          errorIndices.set(writeError.index, code === 11000 ? "DUPLICATE" : "WRITE_FAILED");
        }
      }

      operationRows.forEach((row, index) => {
        const message = errorIndices.get(index);
        if (message === "DUPLICATE") {
          skipped.push({ ...row, status: "duplicate", errors: ["A contact with this number already exists."] });
        } else if (message) {
          failed.push({ ...row, status: "invalid", errors: ["Database write failed for this record."] });
        } else if (writeErrors.length === 0) {
          failed.push({ ...row, status: "invalid", errors: ["Batch write status is unknown. Verify this number before retrying."] });
        } else if (row.status === "update" && updateExisting) {
          updated.push(row);
        } else if (insertedIndices.has(index)) {
          successful.push(row);
        } else {
          skipped.push({ ...row, status: "duplicate", errors: ["A contact with this number already exists."] });
        }
      });
    }
  }

  return { successful, skipped, updated, failed };
}

