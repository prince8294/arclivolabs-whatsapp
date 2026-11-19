import { Types } from "mongoose";
import { scanAudience, type EligibleRecipient } from "@/lib/campaigns/audience";
import CampaignRecipient from "@/lib/models/campaign-recipient";

type CampaignSnapshotSource = {
  _id: Types.ObjectId;
  categoryIds: Types.ObjectId[];
  cities: string[];
  variableMappings: { number: number; mapping: string }[];
};

type TemplateSnapshotSource = {
  _id: Types.ObjectId;
  name: string;
  language: string;
  metaCategory: string;
  body: string;
  header: string;
  footer: string;
};

function eligibleDocument(campaignId: Types.ObjectId, recipient: EligibleRecipient, template: TemplateSnapshotSource) {
  const renderedBody = template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) =>
    recipient.templateVariables[Number(number) - 1] ?? ""
  );
  return {
    campaignId,
    contactId: recipient.contactId,
    phoneNumber: recipient.phoneNumber,
    businessName: recipient.businessName,
    contactPerson: recipient.contactPerson,
    categoryId: recipient.categoryId,
    categoryName: recipient.categoryName,
    city: recipient.city,
    messageMode: "approved_template" as const,
    templateId: template._id,
    templateName: template.name,
    templateLanguage: template.language,
    templateCategory: template.metaCategory,
    templateVariables: recipient.templateVariables,
    renderedMessage: [template.header, renderedBody, template.footer].filter(Boolean).join("\n\n"),
    eligibilityStatus: "Ready to Send" as const,
    queueStatus: "queued" as const,
    deliveryStatus: "pending" as const
  };
}

export async function createCampaignRecipientSnapshot(
  campaign: CampaignSnapshotSource,
  template: TemplateSnapshotSource
) {
  // A campaign is still a draft here, so replacing an incomplete prior snapshot
  // is safe and makes retries deterministic. Started campaigns never call this.
  await CampaignRecipient.deleteMany({ campaignId: campaign._id });
  let eligible = 0;
  let excluded = 0;

  for await (const batch of scanAudience({
    categoryIds: campaign.categoryIds.map(String),
    cities: campaign.cities,
    variableMappings: campaign.variableMappings.map((item) => ({
      number: item.number,
      mapping: item.mapping as "contactPerson" | "businessName" | "city"
    })),
    body: template.body
  })) {
    const documents = [
      ...batch.eligible.map((recipient) => eligibleDocument(campaign._id, recipient, template)),
      ...batch.excluded.map((recipient) => ({
        campaignId: campaign._id,
        contactId: recipient.contactId,
        phoneNumber: recipient.phoneNumber,
        businessName: recipient.businessName,
        contactPerson: recipient.contactPerson,
        categoryId: recipient.categoryId,
        categoryName: recipient.categoryName,
        city: recipient.city,
        messageMode: "approved_template" as const,
        templateId: template._id,
        templateName: template.name,
        templateLanguage: template.language,
        templateCategory: template.metaCategory,
        eligibilityStatus: recipient.errorCode === "SUPPRESSED"
          ? "Suppressed" as const
          : recipient.errorCode === "INVALID_WHATSAPP_NUMBER"
            ? "Invalid Number" as const
            : recipient.errorCode === "DUPLICATE_PHONE"
              ? "Duplicate Contact" as const
              : recipient.errorCode === "MISSING_TEMPLATE_VARIABLE"
                ? "Missing Variable" as const
                : "Missing Consent" as const,
        exclusionReason: recipient.errorMessage,
        queueStatus: "excluded" as const,
        deliveryStatus: "pending" as const,
        errorCode: recipient.errorCode,
        errorMessage: recipient.errorMessage
      }))
    ];
    if (documents.length) await CampaignRecipient.insertMany(documents, { ordered: false });
    eligible += batch.eligible.length;
    excluded += batch.excluded.length;
  }
  return { total: eligible + excluded, eligible, excluded };
}
