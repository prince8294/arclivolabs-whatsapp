import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { campaignDateCriteria, parseAnalyticsFilters, recipientCategoryCriteria } from "@/lib/analytics/reporting";
import { connectToDatabase } from "@/lib/db/mongodb";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import Category from "@/lib/models/category";
import Conversation from "@/lib/models/conversation";
import WhatsAppMessage from "@/lib/models/whatsapp-message";

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const parsed = parseAnalyticsFilters(request);
  if (!parsed.ok) return parsed.response;
  const params = request.nextUrl.searchParams;
  const search = (params.get("search") ?? "").trim().slice(0, 120);
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return NextResponse.json({ error: { code: "INVALID_PAGINATION", message: "Page or page size is invalid." } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    const filter: Record<string, unknown> = campaignDateCriteria(parsed.filters);
    if (search) filter.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    const [campaigns, total] = await Promise.all([
      Campaign.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Campaign.countDocuments(filter)
    ]);
    const campaignIds = campaigns.map((campaign) => campaign._id);
    const [categoryRows, recipientRows, replyRows] = await Promise.all([
      Category.find({ _id: { $in: campaigns.flatMap((campaign) => campaign.categoryIds) } }).select("name").lean(),
      CampaignRecipient.aggregate([
        { $match: { campaignId: { $in: campaignIds }, ...recipientCategoryCriteria(parsed.filters) } },
        {
          $lookup: {
            from: Conversation.collection.name,
            localField: "phoneNumber",
            foreignField: "phoneNumber",
            pipeline: [{ $match: { leadStatus: "Interested" } }, { $project: { _id: 1 } }, { $limit: 1 }],
            as: "interestedConversation"
          }
        },
        {
          $group: {
            _id: "$campaignId",
            totalRecipients: { $sum: 1 },
            accepted: { $sum: { $cond: [{ $eq: ["$queueStatus", "accepted"] }, 1, 0] } },
            sent: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["sent", "delivered", "read"]] }, 1, 0] } },
            delivered: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["delivered", "read"]] }, 1, 0] } },
            read: { $sum: { $cond: [{ $eq: ["$deliveryStatus", "read"] }, 1, 0] } },
            interestedContacts: {
              $addToSet: { $cond: [{ $gt: [{ $size: "$interestedConversation" }, 0] }, "$contactId", null] }
            }
          }
        },
        {
          $project: {
            totalRecipients: 1,
            accepted: 1,
            sent: 1,
            delivered: 1,
            read: 1,
            interestedLeads: { $size: { $setDifference: ["$interestedContacts", [null]] } }
          }
        }
      ]),
      WhatsAppMessage.aggregate([
        {
          $match: {
            campaignId: { $in: campaignIds },
            direction: "incoming",
            messageTimestamp: { $gte: parsed.filters.start, $lt: parsed.filters.end }
          }
        },
        { $group: { _id: { campaignId: "$campaignId", messageId: "$messageId" }, contactId: { $first: "$contactId" }, phoneNumber: { $first: "$phoneNumber" } } },
        {
          $group: {
            _id: "$_id.campaignId",
            replied: { $sum: 1 },
            responders: { $addToSet: { $ifNull: ["$contactId", "$phoneNumber"] } }
          }
        },
        { $project: { replied: 1, uniqueResponders: { $size: "$responders" } } }
      ])
    ]);
    const categoriesById = new Map(categoryRows.map((category) => [String(category._id), category.name]));
    const statsById = new Map(recipientRows.map((row) => [String(row._id), row]));
    const repliesById = new Map(replyRows.map((row) => [String(row._id), row]));
    return NextResponse.json({
      timezone: "UTC",
      campaigns: campaigns.map((campaign) => {
        const id = String(campaign._id);
        const stats = statsById.get(id) ?? { totalRecipients: 0, accepted: 0, sent: 0, delivered: 0, read: 0, interestedLeads: 0 };
        const replies = repliesById.get(id) ?? { replied: 0, uniqueResponders: 0 };
        return {
          _id: id,
          name: campaign.name,
          categoryNames: campaign.categoryIds.map((categoryId) => categoriesById.get(String(categoryId)) ?? "Removed category"),
          totalRecipients: stats.totalRecipients,
          accepted: stats.accepted,
          sent: stats.sent,
          delivered: stats.delivered,
          read: stats.read,
          replied: replies.replied,
          interestedLeads: stats.interestedLeads,
          status: campaign.status,
          createdAt: campaign.createdAt
        };
      }),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error("Campaign analytics could not be loaded.", error);
    return NextResponse.json({ error: { code: "ANALYTICS_CAMPAIGNS_FAILED", message: "Campaign performance could not be loaded." } }, { status: 500 });
  }
}
