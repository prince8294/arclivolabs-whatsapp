import { Types } from "mongoose";
import { scanAudience, type EligibleRecipient } from "@/lib/campaigns/audience";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import {
  existingCampaignReservations,
  reserveCampaignRecipients
} from "@/lib/campaigns/reservations";
import { extractComponentTemplateVariables } from "@/lib/campaigns/meta-templates";

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
  buttons: { text: string; url?: string }[];
};

function eligibleDocument(campaignId: Types.ObjectId, recipient: EligibleRecipient, template: TemplateSnapshotSource) {
  const renderedBody = template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) =>
    recipient.templateVariables[Number(number) - 1] ?? ""
  );
  const renderedHeader = template.header.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) =>
    recipient.templateVariables[Number(number) - 1] ?? ""
  );
  const renderedButtons = template.buttons.map((button) =>
    `${button.text ?? ""}${button.url ? ` · ${button.url.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, number: string) => recipient.templateVariables[Number(number) - 1] ?? "")}` : ""}`
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
    renderedMessage: [renderedHeader, renderedBody, template.footer, ...renderedButtons].filter(Boolean).join("\n\n"),
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
    campaignId: String(campaign._id),
    variableMappings: campaign.variableMappings.map((item) => ({
      number: item.number,
      mapping: item.mapping as "contactPerson" | "businessName" | "city"
    })),
    body: template.body,
    variableNumbers: extractComponentTemplateVariables(template)
  })) {
    const savedContactIds = new Set<string>();
    const recipientIds = await existingCampaignReservations(
      campaign._id,
      batch.eligible.map((recipient) => recipient.phoneNumber)
    );
    const eligibleCandidates = batch.eligible.map((recipient) => ({
      recipient,
      recipientId: recipientIds.get(recipient.phoneNumber) ?? new Types.ObjectId()
    }));
    const reserved = await reserveCampaignRecipients(eligibleCandidates.map(({ recipient, recipientId }) => ({
      phoneNumber: recipient.phoneNumber,
      campaignId: campaign._id,
      campaignRecipientId: recipientId
    })));
    const reservedEligible = eligibleCandidates.filter(({ recipientId }) => reserved.has(String(recipientId)));
    const reservationExcluded = eligibleCandidates
      .filter(({ recipientId }) => !reserved.has(String(recipientId)))
      .map(({ recipient }) => ({
        ...recipient,
        errorCode: "DUPLICATE_PHONE",
        errorMessage: "Another campaign reserved this number first."
      }));
    const documents = [
      ...reservedEligible.flatMap(({ recipient, recipientId }) => {
        const key = String(recipient.contactId);
        if (savedContactIds.has(key)) return [];
        savedContactIds.add(key);
        return [{ _id: recipientId, ...eligibleDocument(campaign._id, recipient, template) }];
      }),
      ...[...batch.excluded, ...reservationExcluded].flatMap((recipient) => {
        const key = String(recipient.contactId);
        if (savedContactIds.has(key)) return [];
        savedContactIds.add(key);
        return [{
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
                : recipient.errorCode === "WRONG_CATEGORY"
                  ? "Wrong Category" as const
                : "Missing Consent" as const,
        exclusionReason: recipient.errorMessage,
        queueStatus: "excluded" as const,
        deliveryStatus: "pending" as const,
        errorCode: recipient.errorCode,
        errorMessage: recipient.errorMessage
        }];
      })
    ];
    if (documents.length) await CampaignRecipient.insertMany(documents, { ordered: false });
    eligible += reservedEligible.length;
    excluded += batch.excluded.length + reservationExcluded.length + (batch.eligible.length - reservedEligible.length);
  }
  return { total: eligible + excluded, eligible, excluded };
}
