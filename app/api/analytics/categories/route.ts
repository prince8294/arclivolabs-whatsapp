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
  try {
    await connectToDatabase();
    const { filters } = parsed;
    const campaigns = await Campaign.find(campaignDateCriteria(filters)).select("_id").lean();
    const campaignIds = campaigns.map((campaign) => campaign._id);
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
            {
              $match: {
                $expr: { $eq: ["$campaignRecipientId", "$$recipientId"] },
                direction: "incoming",
                messageTimestamp: { $gte: filters.start, $lt: filters.end }
              }
            },
            { $group: { _id: "$messageId" } },
            { $project: { _id: 0 } }
          ],
          as: "attributedReplies"
        }
      },
      {
        $group: {
          _id: { categoryId: "$categoryId", categoryName: "$categoryName" },
          contacts: { $addToSet: "$contactId" },
          messagesSent: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["sent", "delivered", "read"]] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["delivered", "read"]] }, 1, 0] } },
          replies: { $sum: { $size: "$attributedReplies" } },
          responders: { $sum: { $cond: [{ $gt: [{ $size: "$attributedReplies" }, 0] }, 1, 0] } },
          interestedContacts: {
            $addToSet: {
              $cond: [{ $gt: [{ $size: "$interestedConversation" }, 0] }, "$contactId", null]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          categoryId: { $toString: "$_id.categoryId" },
          categoryName: "$_id.categoryName",
          contactsTargeted: { $size: "$contacts" },
          messagesSent: 1,
          delivered: 1,
          replies: 1,
          interestedLeads: { $size: { $setDifference: ["$interestedContacts", [null]] } }
        }
      },
      { $sort: { categoryName: 1 } }
    ]);
    const knownCategories = await Category.find().select("_id name").sort({ name: 1 }).lean();
    return NextResponse.json({
      timezone: "UTC",
      categories: rows,
      availableCategories: knownCategories.map((category) => ({ _id: String(category._id), name: category.name })),
      attributionNote: "Replies are included only when the incoming message links directly to a campaign recipient."
    });
  } catch (error) {
    console.error("Category analytics could not be loaded.", error);
    return NextResponse.json({ error: { code: "ANALYTICS_CATEGORIES_FAILED", message: "Category performance could not be loaded." } }, { status: 500 });
  }
}
