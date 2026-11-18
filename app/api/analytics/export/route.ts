import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { campaignDateCriteria, csvResponse, parseAnalyticsFilters, recipientCategoryCriteria } from "@/lib/analytics/reporting";
import { connectToDatabase } from "@/lib/db/mongodb";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import Category from "@/lib/models/category";
import Conversation from "@/lib/models/conversation";
import WhatsAppMessage from "@/lib/models/whatsapp-message";

type ExportType = "campaign_summary" | "category_performance" | "recipient_results";

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const parsed = parseAnalyticsFilters(request);
  if (!parsed.ok) return parsed.response;
  const type = request.nextUrl.searchParams.get("type") ?? "campaign_summary";
  if (!["campaign_summary", "category_performance", "recipient_results"].includes(type)) {
    return NextResponse.json({ error: { code: "INVALID_EXPORT_TYPE", message: "Choose a supported report export." } }, { status: 400 });
  }
  const campaignId = request.nextUrl.searchParams.get("campaignId") ?? "";
  if (campaignId && !Types.ObjectId.isValid(campaignId)) {
    return NextResponse.json({ error: { code: "INVALID_CAMPAIGN", message: "Campaign ID is invalid." } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    const { filters } = parsed;
    const campaignFilter: Record<string, unknown> = campaignId
      ? { _id: new Types.ObjectId(campaignId) }
      : campaignDateCriteria(filters);
    const campaigns = await Campaign.find(campaignFilter).select("_id name categoryIds status createdAt").sort({ createdAt: -1 }).lean();
    const campaignIds = campaigns.map((campaign) => campaign._id);
    const filterLabel = campaignId
      ? "Entire campaign (all available records)"
      : `${filters.start.toISOString().slice(0, 10)} to ${new Date(filters.end.getTime() - 86400000).toISOString().slice(0, 10)} UTC`;
    const categoryLabel = filters.categoryId
      ? (await Category.findById(filters.categoryId).select("name").lean())?.name ?? "Selected category"
      : "All categories";
    const appliedFilters = [filterLabel, categoryLabel];

    if (type === "campaign_summary") {
      const [categoryRows, recipientRows, replyRows] = await Promise.all([
        Category.find({ _id: { $in: campaigns.flatMap((campaign) => campaign.categoryIds) } }).select("name").lean(),
        CampaignRecipient.aggregate([
          { $match: { campaignId: { $in: campaignIds }, ...recipientCategoryCriteria(filters) } },
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
              sent: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["sent", "delivered", "read"]] }, 1, 0] } },
              delivered: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["delivered", "read"]] }, 1, 0] } },
              read: { $sum: { $cond: [{ $eq: ["$deliveryStatus", "read"] }, 1, 0] } },
              failed: { $sum: { $cond: [{ $or: [{ $eq: ["$queueStatus", "failed"] }, { $eq: ["$deliveryStatus", "failed"] }] }, 1, 0] } },
              interested: { $addToSet: { $cond: [{ $gt: [{ $size: "$interestedConversation" }, 0] }, "$contactId", null] } }
            }
          },
          { $project: { totalRecipients: 1, sent: 1, delivered: 1, read: 1, failed: 1, interestedLeads: { $size: { $setDifference: ["$interested", [null]] } } } }
        ]),
        WhatsAppMessage.aggregate([
          { $match: { campaignId: { $in: campaignIds }, direction: "incoming", messageTimestamp: { $gte: filters.start, $lt: filters.end } } },
          { $group: { _id: { campaignId: "$campaignId", messageId: "$messageId" } } },
          { $group: { _id: "$_id.campaignId", replies: { $sum: 1 } } }
        ])
      ]);
      const names = new Map(categoryRows.map((row) => [String(row._id), row.name]));
      const stats = new Map(recipientRows.map((row) => [String(row._id), row]));
      const replies = new Map(replyRows.map((row) => [String(row._id), row.replies]));
      const rows: unknown[][] = [[
        "Applied date range (UTC)", "Applied category filter", "Campaign Name", "Business Category",
        "Total Recipients", "Sent", "Delivered", "Read", "Replied", "Interested Leads", "Status", "Date"
      ]];
      for (const campaign of campaigns) {
        const values = stats.get(String(campaign._id)) ?? {};
        rows.push([
          ...appliedFilters, campaign.name,
          campaign.categoryIds.map((id) => names.get(String(id)) ?? "Removed category").join("; "),
          values.totalRecipients ?? 0, values.sent ?? 0, values.delivered ?? 0, values.read ?? 0,
          replies.get(String(campaign._id)) ?? 0, values.interestedLeads ?? 0, campaign.status, campaign.createdAt.toISOString()
        ]);
      }
      return csvResponse(rows, "campaign-summary.csv");
    }

    if (type === "recipient_results") {
      const recipients = await CampaignRecipient.find({
        campaignId: { $in: campaignIds },
        ...recipientCategoryCriteria(filters)
      }).sort({ createdAt: 1, _id: 1 }).lean();
      const recipientIds = recipients.map((recipient) => recipient._id);
      const phones = recipients.map((recipient) => recipient.phoneNumber);
      const [conversations, replyRecipientIds] = await Promise.all([
        Conversation.find({ phoneNumber: { $in: phones } }).select("_id phoneNumber leadStatus").lean(),
        WhatsAppMessage.distinct("campaignRecipientId", {
          campaignId: { $in: campaignIds },
          campaignRecipientId: { $in: recipientIds },
          direction: "incoming"
        })
      ]);
      const conversationByPhone = new Map(conversations.map((conversation) => [conversation.phoneNumber, conversation]));
      const replied = new Set(replyRecipientIds.map(String));
      const campaignNames = new Map(campaigns.map((campaign) => [String(campaign._id), campaign.name]));
      const rows: unknown[][] = [[
        "Applied date range (UTC)", "Applied category filter", "Campaign Name", "Business Name",
        "WhatsApp Number", "Category", "Message Status", "Reply Received", "Lead Status"
      ]];
      for (const recipient of recipients) {
        rows.push([
          ...appliedFilters,
          campaignNames.get(String(recipient.campaignId)) ?? "",
          recipient.businessName || recipient.contactPerson || "",
          recipient.phoneNumber,
          recipient.categoryName,
          recipient.deliveryStatus,
          replied.has(String(recipient._id)) ? "Yes" : "No",
          conversationByPhone.get(recipient.phoneNumber)?.leadStatus ?? "New"
        ]);
      }
      return csvResponse(rows, "recipient-results.csv");
    }

    const rows = await CampaignRecipient.aggregate([
      { $match: { campaignId: { $in: campaignIds }, ...recipientCategoryCriteria(filters) } },
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
        $lookup: {
          from: WhatsAppMessage.collection.name,
          let: { recipientId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$campaignRecipientId", "$$recipientId"] }, direction: "incoming", ...(campaignId ? {} : { messageTimestamp: { $gte: filters.start, $lt: filters.end } }) } },
            { $group: { _id: "$messageId" } }
          ],
          as: "attributedReplies"
        }
      },
      {
        $group: {
          _id: { categoryId: "$categoryId", categoryName: "$categoryName" },
          contacts: { $addToSet: "$contactId" },
          sent: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["sent", "delivered", "read"]] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["delivered", "read"]] }, 1, 0] } },
          replies: { $sum: { $size: "$attributedReplies" } },
          interested: { $addToSet: { $cond: [{ $gt: [{ $size: "$interestedConversation" }, 0] }, "$contactId", null] } }
        }
      },
      {
        $project: {
          _id: 0,
          name: "$_id.categoryName",
          contactsTargeted: { $size: "$contacts" },
          sent: 1,
          delivered: 1,
          replies: 1,
          interestedLeads: { $size: { $setDifference: ["$interested", [null]] } }
        }
      },
      { $sort: { name: 1 } }
    ]);
    return csvResponse([
      ["Applied date range (UTC)", "Applied category filter", "Category", "Contacts Targeted", "Messages Sent", "Delivered", "Replies", "Interested Leads"],
      ...rows.map((row) => [ ...appliedFilters, row.name, row.contactsTargeted, row.sent, row.delivered, row.replies, row.interestedLeads ])
    ], "category-performance.csv");
  } catch (error) {
    console.error("Analytics report export failed.", error);
    return NextResponse.json({ error: { code: "ANALYTICS_EXPORT_FAILED", message: "The report could not be exported." } }, { status: 500 });
  }
}
