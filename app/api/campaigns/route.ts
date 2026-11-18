import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import Category from "@/lib/models/category";
import MessageTemplate from "@/lib/models/message-template";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import { parseCampaignInput } from "@/lib/campaigns/input";

function dbError(error: unknown) {
  console.error("Campaign API request failed.", error);
  return NextResponse.json({ error: { code: "CAMPAIGN_REQUEST_FAILED", message: "Campaign data could not be loaded or saved." } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const campaigns = await Campaign.find().sort({ createdAt: -1 }).limit(200).lean();
    const categories = await Category.find({
      _id: { $in: campaigns.flatMap((campaign) => campaign.categoryIds) }
    }).select("name").lean();
    const templates = await MessageTemplate.find({
      _id: { $in: campaigns.map((campaign) => campaign.templateId).filter(Boolean) }
    }).select("name").lean();
    const categoryNames = new Map(categories.map((item) => [String(item._id), item.name]));
    const templateNames = new Map(templates.map((item) => [String(item._id), item.name]));
    const items = campaigns.map((campaign) => ({
      ...campaign,
      _id: String(campaign._id),
      categoryNames: campaign.categoryIds.map((id) => categoryNames.get(String(id)) ?? "Removed category"),
      templateName: campaign.templateId ? templateNames.get(String(campaign.templateId)) ?? "Removed template" : ""
    }));
    const [totalCampaigns, accepted, sent, delivered, failed, replies] = await Promise.all([
      Campaign.countDocuments(),
      CampaignRecipient.countDocuments({ queueStatus: "accepted" }),
      CampaignRecipient.countDocuments({ deliveryStatus: { $in: ["sent", "delivered", "read"] } }),
      CampaignRecipient.countDocuments({ deliveryStatus: { $in: ["delivered", "read"] } }),
      CampaignRecipient.countDocuments({ $or: [{ queueStatus: "failed" }, { deliveryStatus: "failed" }] }),
      WhatsAppMessage.countDocuments({ direction: "incoming" })
    ]);
    return NextResponse.json({
      campaigns: items,
      stats: {
        totalCampaigns,
        messagesSent: sent,
        messagesAcceptedByMeta: accepted,
        messagesDelivered: delivered,
        messagesFailed: failed,
        totalReplies: replies
      }
    });
  } catch (error) {
    return dbError(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  const parsed = parseCampaignInput(body, true);
  if (!parsed.ok) return NextResponse.json({ error: { code: "INVALID_CAMPAIGN", message: parsed.message } }, { status: 400 });
  try {
    await connectToDatabase();
    const { categoryIds, templateId } = parsed.value;
    if (categoryIds.length !== await Category.countDocuments({ _id: { $in: categoryIds } })) {
      return NextResponse.json({ error: { code: "CATEGORY_NOT_FOUND", message: "One or more selected business categories no longer exist." } }, { status: 400 });
    }
    if (templateId && !(await MessageTemplate.exists({ _id: new Types.ObjectId(templateId) }))) {
      return NextResponse.json({ error: { code: "TEMPLATE_NOT_FOUND", message: "Selected WhatsApp template was not found." } }, { status: 400 });
    }
    const campaign = await Campaign.create({
      ...parsed.value,
      categoryIds: categoryIds.map((id) => new Types.ObjectId(id)),
      templateId: templateId ? new Types.ObjectId(templateId) : null,
      status: "Draft"
    });
    return NextResponse.json({ campaign: { _id: campaign._id.toString(), name: campaign.name, status: campaign.status } }, { status: 201 });
  } catch (error) {
    return dbError(error);
  }
}
