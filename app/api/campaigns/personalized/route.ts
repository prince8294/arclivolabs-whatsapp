import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import { inspectPersonalizedRows, parsePersonalizedRows } from "@/lib/campaigns/personalized";
import { reserveCampaignRecipients } from "@/lib/campaigns/reservations";
import { refreshCampaignCounts } from "@/lib/campaigns/counts";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import CampaignRecipientReservation from "@/lib/models/campaign-recipient-reservation";
import Contact from "@/lib/models/contact";
import { normalizePhoneNumber } from "@/lib/contacts/validation";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  if (!isAdminSessionValid(request)) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: { code: "INVALID_IMPORT", message: "Import request must be an object." } }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (input.mode !== "approved_template") {
    return NextResponse.json({ error: { code: "APPROVED_TEMPLATE_REQUIRED", message: "Bulk marketing requires a currently approved Meta template." } }, { status: 400 });
  }
  if (input.confirm !== true) return NextResponse.json({ error: { code: "CONFIRMATION_REQUIRED", message: "Confirm the reviewed import before saving it." } }, { status: 400 });
  if (typeof input.categoryId !== "string" || !Types.ObjectId.isValid(input.categoryId)) {
    return NextResponse.json({ error: { code: "CATEGORY_REQUIRED", message: "Select exactly one campaign category." } }, { status: 400 });
  }
  const parsed = parsePersonalizedRows(input.rows);
  if (!parsed.ok) return NextResponse.json({ error: { code: "INVALID_IMPORT", message: parsed.message } }, { status: 400 });

  try {
    await connectToDatabase();
    const categoryId = new Types.ObjectId(input.categoryId);
    const generatedName = `Bulk campaign ${new Date().toISOString().slice(0, 10)}`;
    const name = typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, 120)
      : generatedName;
    let inspected = await inspectPersonalizedRows(
      parsed.rows,
      "approved_template",
      typeof input.templateId === "string" ? input.templateId : "",
      input.categoryId
    );
    if (!inspected.template) {
      return NextResponse.json({ error: { code: "TEMPLATE_NOT_APPROVED", message: "Choose a currently approved Meta marketing template." } }, { status: 400 });
    }
    const contactsByPhone = new Map<string, (typeof parsed.rows)[number]>();
    for (const row of parsed.rows) {
      const phoneNumber = normalizePhoneNumber(row.phoneNumber);
      if (phoneNumber && !contactsByPhone.has(phoneNumber)) contactsByPhone.set(phoneNumber, row);
    }
    const contactRows = [...contactsByPhone.entries()];
    if (contactRows.length) {
      await Contact.bulkWrite(contactRows.map(([phoneNumber, row]) => ({
        updateOne: {
          filter: { phoneNumber },
          update: {
            $set: {
              businessName: row.businessName.trim() || phoneNumber,
              categoryId,
              ...(row.city.trim() ? { city: row.city.trim() } : {})
            },
            $setOnInsert: { phoneNumber }
          },
          upsert: true
        }
      })), { ordered: false });
      inspected = await inspectPersonalizedRows(
        parsed.rows,
        "approved_template",
        typeof input.templateId === "string" ? input.templateId : "",
        input.categoryId
      );
    }
    if (!inspected.rows.some((row) => row.eligible)) {
      const duplicateCampaignIds = new Set(
        inspected.rows
          .filter((row) => row.duplicateCampaignId)
          .map((row) => row.duplicateCampaignId)
      );
      if (
        inspected.rows.every((row) => row.eligibilityStatus === "Duplicate Contact") &&
        duplicateCampaignIds.size === 1
      ) {
        const [existingCampaignId] = duplicateCampaignIds;
        const existingDraft = Types.ObjectId.isValid(existingCampaignId)
          ? await Campaign.findOne({ _id: existingCampaignId, status: "Draft" }).select("_id").lean()
          : null;
        if (existingDraft) {
          return NextResponse.json({
            error: {
              code: "EXISTING_DRAFT_CAMPAIGN",
              message: "These recipients are already saved in an existing draft campaign. Opening that campaign instead."
            },
            campaignId: String(existingDraft._id)
          }, { status: 409 });
        }
      }
      const allMissingConsent = inspected.summary.noConsentOrOptedOut === inspected.summary.totalRows;
      return NextResponse.json({
        error: {
          code: "NO_ELIGIBLE_RECIPIENTS",
          message: allMissingConsent
            ? "Contacts were imported, but none has current documented marketing opt-in. Record consent in Contacts before creating this campaign."
            : "Contacts were imported, but every row is excluded. Review consent, prior campaigns, phone numbers, category, and required template values."
        }
      }, { status: 400 });
    }
    if (!inspected.template) {
      return NextResponse.json({ error: { code: "TEMPLATE_NOT_APPROVED", message: "The selected template is no longer available." } }, { status: 409 });
    }
    const template = inspected.template;

    const importBatchId = randomUUID();
    const description = typeof input.description === "string" ? input.description.trim().slice(0, 1000) : "";
    const campaign = await Campaign.create({
      name,
      description,
      importBatchId,
      messageMode: "approved_template",
      categoryIds: [categoryId],
      cities: [...new Set(inspected.rows.map((row) => row.city).filter(Boolean))],
      templateId: template._id,
      templateName: template.name,
      templateLanguage: template.language,
      templateCategory: "MARKETING",
      templateBody: template.body,
      templateHeader: template.header,
      templateHeaderFormat: template.headerFormat,
      templateHeaderMediaUrl: template.headerMediaUrl,
      templateFooter: template.footer,
      templateButtons: template.buttons,
      status: "Draft",
      dispatchStatus: "completed"
    });

    const recipientIds = new Map<number, Types.ObjectId>();
    for (const row of inspected.rows) recipientIds.set(row.row, new Types.ObjectId());
    const candidates = inspected.rows.filter((row) => row.eligible).map((row) => ({
      phoneNumber: row.normalizedPhoneNumber,
      campaignId: campaign._id,
      campaignRecipientId: recipientIds.get(row.row)!
    }));
    try {
      const reserved = await reserveCampaignRecipients(candidates);
      for (const row of inspected.rows) {
        const recipientId = recipientIds.get(row.row);
        if (row.eligible && recipientId && !reserved.has(String(recipientId))) {
          row.eligible = false;
          row.eligibilityStatus = "Duplicate Contact";
          row.duplicateType = "already_reserved";
          row.exclusionReason = "Another campaign reserved this number first.";
        }
      }

      const claimed = inspected.rows.filter((row) => row.eligible);
      if (!claimed.length) {
        await Campaign.deleteOne({ _id: campaign._id, status: "Draft" });
        return NextResponse.json({ error: { code: "NO_ELIGIBLE_RECIPIENTS", message: "Every recipient was reserved by another campaign before this import could be saved." } }, { status: 409 });
      }

      const usedContacts = new Set<string>();
      const preferredRows = [...inspected.rows].sort((a, b) => Number(b.eligible) - Number(a.eligible));
      const recipientDocuments = preferredRows.flatMap((row) => {
        if (!row.contactId || !row.normalizedPhoneNumber || row.duplicateType === "within_csv") return [];
        const contactId = String(row.contactId);
        if (usedContacts.has(contactId)) return [];
        usedContacts.add(contactId);
        const recipientId = recipientIds.get(row.row);
        if (!recipientId) return [];
        return [{
          _id: recipientId,
          campaignId: campaign._id,
          contactId: row.contactId,
          importBatchId,
          importRowNumber: row.row,
          phoneNumber: row.normalizedPhoneNumber,
          businessName: row.businessName,
          categoryId,
          categoryName: row.categoryName,
          city: row.city,
          messageMode: "approved_template" as const,
          templateId: inspected.template!._id,
          templateName: inspected.template!.name,
          templateLanguage: inspected.template!.language,
          templateCategory: "MARKETING",
          templateVariables: row.templateVariables,
          renderedMessage: row.renderedMessage,
          eligibilityStatus: row.eligibilityStatus,
          exclusionReason: row.exclusionReason,
          duplicateType: row.duplicateType,
          duplicateCampaignId: Types.ObjectId.isValid(row.duplicateCampaignId) ? new Types.ObjectId(row.duplicateCampaignId) : null,
          duplicateRecordId: row.duplicateRecordId,
          queueStatus: row.eligible ? "queued" as const : "excluded" as const,
          errorCode: row.eligible ? "" : row.eligibilityStatus.toUpperCase().replace(/\s+/g, "_"),
          errorMessage: row.exclusionReason,
          updatedStatusAt: new Date()
        }];
      });
      if (recipientDocuments.length) await CampaignRecipient.insertMany(recipientDocuments, { ordered: true });
      await Contact.updateMany(
        { phoneNumber: { $in: contactRows.map(([phoneNumber]) => phoneNumber) } },
        { $addToSet: { campaignIds: campaign._id, campaignNames: campaign.name } }
      );
      await refreshCampaignCounts(String(campaign._id));
      return NextResponse.json({
        campaignId: String(campaign._id),
        importBatchId,
        contactsImported: contactRows.length,
        eligible: claimed.length,
        excluded: inspected.summary.excludedContacts + (inspected.summary.eligibleContacts - claimed.length),
        summary: {
          ...inspected.summary,
          eligibleContacts: claimed.length,
          excludedContacts: inspected.summary.excludedContacts + (inspected.summary.eligibleContacts - claimed.length),
          previouslyImportedOrContacted: inspected.summary.previouslyImportedOrContacted +
            inspected.rows.filter((row) => row.duplicateType === "already_reserved").length
        }
      }, { status: 201 });
    } catch (error) {
      await CampaignRecipient.deleteMany({ campaignId: campaign._id });
      await CampaignRecipientReservation.deleteMany({ campaignId: campaign._id });
      await Campaign.deleteOne({ _id: campaign._id, status: "Draft" });
      throw error;
    }
  } catch (error) {
    console.error("Approved-template campaign import failed.", error);
    return NextResponse.json({ error: { code: "PERSONALIZED_IMPORT_FAILED", message: "The campaign could not be created." } }, { status: 500 });
  }
}
