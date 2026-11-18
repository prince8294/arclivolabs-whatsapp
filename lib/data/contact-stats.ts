import Contact from "@/lib/models/contact";

export async function getContactStats() {
  const [totalContacts, categoryIds, optedIn, optedOut] = await Promise.all([
    Contact.countDocuments(),
    Contact.distinct("categoryId", { categoryId: { $exists: true, $ne: null } }),
    Contact.countDocuments({ marketingConsentStatus: "Opted In" }),
    Contact.countDocuments({ marketingConsentStatus: "Opted Out" })
  ]);
  return {
    totalContacts,
    categoriesWithContacts: categoryIds.length,
    optedIn,
    optedOut
  };
}
