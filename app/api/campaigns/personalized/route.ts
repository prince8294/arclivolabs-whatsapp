import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import { inspectPersonalizedRows, parsePersonalizedRows, personalizedModes } from "@/lib/campaigns/personalized";
import { refreshCampaignCounts } from "@/lib/campaigns/counts";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import Contact from "@/lib/models/contact";
import MessageSuppression from "@/lib/models/message-suppression";

function validDocumentedDate(value: string) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now() ? date : null;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  if (!isAdminSessionValid(request)) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: { code: "INVALID_IMPORT", message: "Import request must be an object." } }, { status: 400 });
  const input = body as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!name || name.length > 120 || description.length > 1000) return NextResponse.json({ error: { code: "INVALID_CAMPAIGN", message: "A campaign name of up to 120 characters is required." } }, { status: 400 });
  if (!personalizedModes.includes(input.mode as (typeof personalizedModes)[number])) return NextResponse.json({ error: { code: "SENDING_MODE_REQUIRED", message: "Explicitly choose a sending mode." } }, { status: 400 });
  if (input.confirm !== true) return NextResponse.json({ error: { code: "CONFIRMATION_REQUIRED", message: "Confirm the reviewed import before saving it." } }, { status: 400 });
  const parsed = parsePersonalizedRows(input.rows);
  if (!parsed.ok) return NextResponse.json({ error: { code: "INVALID_IMPORT", message: parsed.message } }, { status: 400 });
  const selectedRows = Array.isArray(input.selectedRows) ? new Set(input.selectedRows.filter((item): item is number => Number.isInteger(item))) : null;
  const manuallyExcludedRows = new Set(Array.isArray(input.excludedRows) ? input.excludedRows.filter((item): item is number => Number.isInteger(item)) : []);
  try {
    await connectToDatabase();
    const mode = input.mode as (typeof personalizedModes)[number];
    const inspected = await inspectPersonalizedRows(parsed.rows, mode, typeof input.templateId === "string" ? input.templateId : "");
    const rows = selectedRows ? inspected.rows.filter((row) => selectedRows.has(row.row)) : inspected.rows;
    for (const row of rows) {
      if (manuallyExcludedRows.has(row.row)) {
        row.eligible = false;
        row.eligibilityStatus = "Excluded";
        row.exclusionReason = "Manually excluded during campaign preview.";
      }
    }
    if (!rows.length) return NextResponse.json({ error: { code: "EMPTY_SELECTION", message: "Select at least one previewed recipient." } }, { status: 400 });
    if (!rows.some((row) => row.eligible)) return NextResponse.json({ error: { code: "NO_ELIGIBLE_RECIPIENTS", message: "The selected rows contain no recipients currently eligible to send." } }, { status: 400 });
    if (mode === "approved_template" && !inspected.template) return NextResponse.json({ error: { code: "TEMPLATE_NOT_APPROVED", message: "Choose a currently approved Meta template." } }, { status: 400 });

    const importBatchId = randomUUID();
    const categoryIds = [...new Set(rows.flatMap((row) => row.categoryId ? [String(row.categoryId)] : []))];
    const campaign = await Campaign.create({
      name,
      description,
      importBatchId,
      messageMode: mode,
      categoryIds: categoryIds.map((id) => new Types.ObjectId(id)),
      cities: [...new Set(rows.map((row) => row.city).filter(Boolean))],
      templateId: inspected.template?._id ?? null,
      status: "Draft",
      dispatchStatus: "pending"
    });

    try {
      for (const row of rows) {
        if (!row.normalizedPhoneNumber || !row.categoryId) continue;
        const consentDate = validDocumentedDate(row.consentDate);
        const documented = row.consentStatus !== "Unknown" && Boolean(row.consentSource && consentDate);
        await Contact.updateOne(
          { phoneNumber: row.normalizedPhoneNumber },
          {
            $setOnInsert: {
              businessName: row.businessName,
              phoneNumber: row.normalizedPhoneNumber,
              categoryId: row.categoryId,
              city: row.city,
              marketingConsentStatus: documented ? row.consentStatus : "Unknown",
              consentSource: documented ? row.consentSource : "",
              consentTimestamp: documented ? consentDate : null,
              consentHistory: documented ? [{ status: row.consentStatus, source: row.consentSource, timestamp: consentDate }] : []
            }
          },
          { upsert: true }
        );
        if (documented) {
          await Contact.updateOne(
            {
              phoneNumber: row.normalizedPhoneNumber,
              ...(row.consentStatus === "Opted In" ? { marketingConsentStatus: { $ne: "Opted Out" } } : {})
            },
            {
              $set: {
                marketingConsentStatus: row.consentStatus,
                consentSource: row.consentSource,
                consentTimestamp: consentDate
              },
              $addToSet: {
                consentHistory: { status: row.consentStatus, source: row.consentSource, timestamp: consentDate }
              }
            }
          );
        }
      }
      const contacts = await Contact.find({ phoneNumber: { $in: rows.map((row) => row.normalizedPhoneNumber).filter(Boolean) } }).select("_id phoneNumber marketingConsentStatus").lean();
      const contactsByPhone = new Map(contacts.map((contact) => [contact.phoneNumber, contact]));
      const optedOut = contacts.filter((contact) => contact.marketingConsentStatus === "Opted Out");
      if (optedOut.length) {
        await MessageSuppression.bulkWrite(optedOut.map((contact) => ({ updateOne: {
          filter: { phoneNumber: contact.phoneNumber },
          update: { $setOnInsert: { phoneNumber: contact.phoneNumber, contactId: contact._id, reason: "Opted Out", source: "Personalized CSV import", suppressedAt: new Date() } },
          upsert: true
        } })), { ordered: false });
      }
      const recipientRows = rows.filter((row) =>
        row.normalizedPhoneNumber && row.categoryId && row.eligibilityStatus !== "Duplicate Contact"
      );
      await CampaignRecipient.insertMany(recipientRows.map((row) => {
        const contact = contactsByPhone.get(row.normalizedPhoneNumber);
        return {
          campaignId: campaign._id,
          contactId: contact?._id ?? null,
          importBatchId,
          importRowNumber: row.row,
          phoneNumber: row.normalizedPhoneNumber || row.phoneNumber,
          businessName: row.businessName,
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          city: row.city,
          messageMode: mode,
          originalCsvMessage: row.message,
          templateId: inspected.template?._id ?? null,
          templateVariables: row.templateVariables,
          renderedMessage: row.renderedMessage,
          eligibilityStatus: row.eligibilityStatus,
          exclusionReason: row.exclusionReason,
          queueStatus: row.eligible ? "queued" : "excluded",
          errorCode: row.eligible ? "" : row.eligibilityStatus.toUpperCase().replace(/\s+/g, "_"),
          errorMessage: row.exclusionReason,
          updatedStatusAt: new Date()
        };
      }), { ordered: true });
    } catch (error) {
      await CampaignRecipient.deleteMany({ campaignId: campaign._id });
      await Campaign.deleteOne({ _id: campaign._id });
      throw error;
    }
    await Campaign.updateOne({ _id: campaign._id }, { $set: { dispatchStatus: "completed" } });
    await refreshCampaignCounts(String(campaign._id));
    return NextResponse.json({ campaignId: String(campaign._id), importBatchId, eligible: rows.filter((row) => row.eligible).length, excluded: rows.filter((row) => !row.eligible).length }, { status: 201 });
  } catch (error) {
    console.error("Personalized campaign import failed.", error);
    return NextResponse.json({ error: { code: "PERSONALIZED_IMPORT_FAILED", message: "The reviewed personalized campaign could not be saved." } }, { status: 500 });
  }
}
