import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import Conversation from "@/lib/models/conversation";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import { campaignDateCriteria, parseAnalyticsFilters, recipientCategoryCriteria } from "@/lib/analytics/reporting";

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const parsed = parseAnalyticsFilters(request);
  if (!parsed.ok) return parsed.response;

  try {
    await connectToDatabase();
    const { filters } = parsed;
    const campaigns = await Campaign.find(campaignDateCriteria(filters)).select("_id").lean();
    const campaignIds = campaigns.map((campaign) => campaign._id);
    const recipientMatch = {
      campaignId: { $in: campaignIds },
      ...recipientCategoryCriteria(filters)
    };

    const [statsRows, interestedRows, replyRows] = await Promise.all([
      CampaignRecipient.aggregate([
        { $match: recipientMatch },
        {
          $group: {
            _id: null,
            messagesSent: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["sent", "delivered", "read"]] }, 1, 0] } },
            delivered: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["delivered", "read"]] }, 1, 0] } },
            read: { $sum: { $cond: [{ $eq: ["$deliveryStatus", "read"] }, 1, 0] } },
            failed: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ["$queueStatus", "excluded"] }, { $or: [{ $eq: ["$queueStatus", "failed"] }, { $eq: ["$deliveryStatus", "failed"] }] }] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]),
      CampaignRecipient.aggregate([
        { $match: recipientMatch },
        {
          $lookup: {
            from: Conversation.collection.name,
            localField: "phoneNumber",
            foreignField: "phoneNumber",
            pipeline: [{ $match: { leadStatus: "Interested" } }, { $project: { _id: 1 } }, { $limit: 1 }],
            as: "interestedConversation"
          }
        },
        { $match: { interestedConversation: { $ne: [] } } },
        { $group: { _id: "$contactId" } },
        { $count: "count" }
      ]),
      WhatsAppMessage.aggregate([
        {
          $match: {
            campaignId: { $in: campaignIds },
            direction: "incoming",
            messageTimestamp: { $gte: filters.start, $lt: filters.end }
          }
        },
        { $group: { _id: "$messageId", contactId: { $first: "$contactId" }, phoneNumber: { $first: "$phoneNumber" } } },
        {
          $group: {
            _id: null,
            replies: { $sum: 1 },
            responders: { $addToSet: { $ifNull: ["$contactId", "$phoneNumber"] } }
          }
        },
        { $project: { replies: 1, uniqueResponders: { $size: "$responders" } } }
      ])
    ]);

    const stats = statsRows[0] ?? { messagesSent: 0, delivered: 0, read: 0, failed: 0 };
    const replies = replyRows[0] ?? { replies: 0, uniqueResponders: 0 };
    return NextResponse.json({
      timezone: "UTC",
      filters: { start: filters.start.toISOString(), endExclusive: filters.end.toISOString(), categoryId: filters.categoryId },
      overview: {
        messagesSent: stats.messagesSent,
        delivered: stats.delivered,
        read: stats.read,
        replies: replies.replies,
        interestedLeads: interestedRows[0]?.count ?? 0,
        failed: stats.failed
      },
      attributionNote: "Replies are counted only when an incoming message has an explicit campaign link in stored WhatsApp data."
    });
  } catch (error) {
    console.error("Analytics overview could not be loaded.", error);
    return NextResponse.json({ error: { code: "ANALYTICS_OVERVIEW_FAILED", message: "Analytics overview could not be loaded." } }, { status: 500 });
  }
}
