import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "../lib/db/mongodb";
import Campaign from "../lib/models/campaign";
import CampaignRecipient from "../lib/models/campaign-recipient";
import Category from "../lib/models/category";
import MessageTemplate from "../lib/models/message-template";
import { createCampaignRecipientSnapshot } from "../lib/campaigns/snapshot";

async function main() {
  if (process.env.ALLOW_CAMPAIGN_DRY_RUN !== "true") {
    throw new Error("Set ALLOW_CAMPAIGN_DRY_RUN=true to run the temporary snapshot persistence test.");
  }

  await connectToDatabase();
  let campaignId: Types.ObjectId | null = null;
  try {
  const category = await Category.findOne({ name: "School" }).lean();
  const template = await MessageTemplate.findOne({
    name: "arclivo_school_intro",
    metaStatus: "APPROVED",
    metaCategory: "MARKETING",
    isDraft: false
  });
  if (!category || !template) throw new Error("Required School/Marketing dry-run fixtures are missing.");

  const campaign = await Campaign.create({
    name: "__dry_run_snapshot__",
    categoryIds: [category._id],
    templateId: template._id,
    status: "Draft"
  });
  campaignId = campaign._id;
  const counts = await createCampaignRecipientSnapshot(campaign, template);
  const rows = await CampaignRecipient.find({ campaignId })
    .select("contactId queueStatus templateName templateLanguage templateCategory renderedMessage")
    .lean();

  console.log({
    counts,
    persisted: rows.length,
    uniqueContacts: new Set(rows.map((row) => String(row.contactId))).size,
    ready: rows.filter((row) => row.queueStatus === "queued").length,
    marketingSnapshots: rows.filter((row) =>
      row.templateCategory === "MARKETING" &&
      row.templateName === "arclivo_school_intro" &&
      row.templateLanguage === "en"
    ).length,
    renderedMessages: rows.filter((row) => Boolean(row.renderedMessage)).length
  });
  } finally {
    if (campaignId) {
      await CampaignRecipient.deleteMany({ campaignId });
      await Campaign.deleteOne({ _id: campaignId, name: "__dry_run_snapshot__" });
    }
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Campaign snapshot dry run failed.");
  process.exitCode = 1;
});
