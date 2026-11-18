import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import Category from "@/lib/models/category";
import Conversation from "@/lib/models/conversation";
import MessageTemplate from "@/lib/models/message-template";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import { percentage } from "@/lib/analytics/reporting";

type RouteContext = { params: { id: string } };
const allowedStatuses = ["all", "pending", "accepted", "sent", "delivered", "read", "failed", "excluded", "uncertain"] as const;

function recipientStatusCriteria(status: string) {
  if (status === "pending") return {
    $or: [
      { queueStatus: { $in: ["queued", "processing", "paused"] } },
      { queueStatus: { $nin: ["excluded", "cancelled"] }, deliveryStatus: { $in: ["pending", "accepted", "uncertain"] } }
    ]
  };
  if (status === "accepted") return { queueStatus: "accepted" };
  if (status === "sent") return { deliveryStatus: "sent" };
  if (status === "delivered") return { deliveryStatus: "delivered" };
  if (status === "read") return { deliveryStatus: "read" };
  if (status === "failed") return { $or: [{ queueStatus: "failed" }, { deliveryStatus: "failed" }] };
  if (status === "excluded") return { queueStatus: "excluded" };
  if (status === "uncertain") return { $or: [{ queueStatus: "uncertain" }, { deliveryStatus: "uncertain" }] };
  return {};
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
  }
  const searchParams = request.nextUrl.searchParams;
  const page = Number(searchParams.get("page") ?? 1);
  const pageSize = Number(searchParams.get("pageSize") ?? 50);
  const search = (searchParams.get("search") ?? "").trim().slice(0, 120);
  const status = (searchParams.get("status") ?? "all").toLowerCase();
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !allowedStatuses.includes(status as (typeof allowedStatuses)[number])) {
    return NextResponse.json({ error: { code: "INVALID_FILTER", message: "Recipient search, status, or pagination is invalid." } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    const campaign = await Campaign.findById(params.id).lean();
    if (!campaign) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
    const [categories, template, allStats, attributedReplies] = await Promise.all([
      Category.find({ _id: { $in: campaign.categoryIds } }).select("name").lean(),
      campaign.templateId ? MessageTemplate.findById(campaign.templateId).select("name,language").lean() : null,
      CampaignRecipient.aggregate([
        { $match: { campaignId: campaign._id } },
        {
          $lookup: {
            from: Conversation.collection.name,
            localField: "phoneNumber",
            foreignField: "phoneNumber",
            pipeline: [{ $project: { leadStatus: 1 } }, { $limit: 1 }],
            as: "conversation"
          }
        },
        {
          $lookup: {
            from: WhatsAppMessage.collection.name,
            let: { recipientId: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$campaignRecipientId", "$$recipientId"] }, direction: "incoming" } },
              { $group: { _id: "$messageId" } },
              { $limit: 1 }
            ],
            as: "attributedReply"
          }
        },
        {
          $group: {
            _id: null,
            totalRecipients: { $sum: 1 },
            accepted: { $sum: { $cond: [{ $eq: ["$queueStatus", "accepted"] }, 1, 0] } },
            sent: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["sent", "delivered", "read"]] }, 1, 0] } },
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
            },
            interestedContacts: {
              $addToSet: { $cond: [{ $eq: [{ $arrayElemAt: ["$conversation.leadStatus", 0] }, "Interested"] }, "$contactId", null] }
            },
            interestedResponders: {
              $addToSet: {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $arrayElemAt: ["$conversation.leadStatus", 0] }, "Interested"] },
                      { $gt: [{ $size: "$attributedReply" }, 0] }
                    ]
                  },
                  "$contactId",
                  null
                ]
              }
            }
          }
        },
        {
          $project: {
            _id: 0, totalRecipients: 1, accepted: 1, sent: 1, delivered: 1, read: 1, failed: 1,
            interestedLeads: { $size: { $setDifference: ["$interestedContacts", [null]] } },
            interestedResponders: { $size: { $setDifference: ["$interestedResponders", [null]] } }
          }
        }
      ]),
      WhatsAppMessage.aggregate([
        { $match: { campaignId: campaign._id, direction: "incoming" } },
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

    const criteria: Record<string, unknown> = {
      campaignId: campaign._id,
      ...recipientStatusCriteria(status)
    };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      criteria.$and = [{
        $or: [
          { businessName: { $regex: escaped, $options: "i" } },
          { phoneNumber: { $regex: escaped, $options: "i" } },
          { categoryName: { $regex: escaped, $options: "i" } }
        ]
      }];
    }
    const [recipients, total] = await Promise.all([
      CampaignRecipient.find(criteria).sort({ createdAt: 1, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      CampaignRecipient.countDocuments(criteria)
    ]);
    const phones = recipients.map((recipient) => recipient.phoneNumber);
    const recipientIds = recipients.map((recipient) => recipient._id);
    const [conversations, replyRecipientIds] = await Promise.all([
      Conversation.find({ phoneNumber: { $in: phones } }).select("_id phoneNumber leadStatus").lean(),
      WhatsAppMessage.distinct("campaignRecipientId", {
        campaignId: campaign._id,
        direction: "incoming",
        campaignRecipientId: { $in: recipientIds }
      })
    ]);
    const conversationByPhone = new Map(conversations.map((conversation) => [conversation.phoneNumber, conversation]));
    const repliedIds = new Set(replyRecipientIds.map(String));
    const stats = allStats[0] ?? { totalRecipients: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0, interestedLeads: 0, interestedResponders: 0 };
    const replies = attributedReplies[0] ?? { replies: 0, uniqueResponders: 0 };
    const deliveredRecipients = await CampaignRecipient.countDocuments({
      campaignId: campaign._id,
      deliveryStatus: { $in: ["delivered", "read"] }
    });
    const summary = {
      ...stats,
      uniqueResponders: replies.uniqueResponders,
      replies: replies.replies,
      deliveredRecipients,
      deliveryRate: percentage(stats.delivered, stats.sent),
      readRate: percentage(stats.read, stats.delivered),
      replyRate: percentage(replies.uniqueResponders, deliveredRecipients),
      interestedLeadRate: percentage(stats.interestedResponders, replies.uniqueResponders)
    };
    return NextResponse.json({
      timezone: "UTC",
      campaign: {
        _id: String(campaign._id),
        name: campaign.name,
        categoryNames: campaign.categoryIds.map((id) => categories.find((category) => String(category._id) === String(id))?.name ?? "Removed category"),
        cities: campaign.cities,
        templateName: template?.name ?? "Removed template",
        templateLanguage: template?.language ?? "",
        startedAt: campaign.startedAt ?? campaign.createdAt,
        status: campaign.status
      },
      summary,
      recipients: recipients.map((recipient) => {
        const conversation = conversationByPhone.get(recipient.phoneNumber);
        return {
          _id: String(recipient._id),
          businessName: recipient.businessName || recipient.contactPerson || recipient.phoneNumber,
          phoneNumber: recipient.phoneNumber,
          categoryName: recipient.categoryName || "—",
          messageStatus: recipient.deliveryStatus,
          replyReceived: repliedIds.has(String(recipient._id)),
          leadStatus: conversation?.leadStatus ?? "New",
          conversationId: conversation ? String(conversation._id) : ""
        };
      }),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      attributionNote: "A responder is counted only when an incoming message links explicitly to this campaign; unlinked conversations are not attributed."
    });
  } catch (error) {
    console.error("Campaign analytics details could not be loaded.", error);
    return NextResponse.json({ error: { code: "ANALYTICS_CAMPAIGN_FAILED", message: "Campaign report could not be loaded." } }, { status: 500 });
  }
}
