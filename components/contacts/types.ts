export type CategoryOption = { _id: string; name: string; icon: string };

export type ContactConsentStatus = "Unknown" | "Opted In" | "Opted Out";

export type ContactRecord = {
  _id: string;
  businessName: string;
  contactPerson: string;
  phoneNumber: string;
  categoryId: string | CategoryOption;
  city: string;
  state: string;
  email: string;
  notes?: string;
  marketingConsentStatus: ContactConsentStatus;
  consentSource?: string;
  consentTimestamp?: string | null;
  consentHistory?: { status: ContactConsentStatus; source: string; timestamp: string }[];
  doNotContact?: boolean;
  createdAt: string;
  updatedAt?: string;
};

export function getContactCategoryId(contact: ContactRecord) {
  return typeof contact.categoryId === "string" ? contact.categoryId : contact.categoryId._id;
}

export function getContactCategoryName(contact: ContactRecord) {
  return typeof contact.categoryId === "string" ? "Category" : contact.categoryId.name;
}

export async function getApiError(response: Response) {
  const result = await response.json().catch(() => null);
  return result?.error?.message ?? "The request could not be completed.";
}
