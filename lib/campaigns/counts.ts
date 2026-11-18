import { Types } from "mongoose";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";

export async function refreshCampaignCounts(campaignId: string) {
  const [campaign, rows] = await Promise.all([
    Campaign.findById(campaignId).select("status dispatchStatus").lean(),
    CampaignRecipient.aggregate([
      { $match: { campaignId: new Types.ObjectId(campaignId) } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          eligible: { $sum: { $cond: [{ $ne: ["$queueStatus", "excluded"] }, 1, 0] } },
          excluded: { $sum: { $cond: [{ $eq: ["$queueStatus", "excluded"] }, 1, 0] } },
          queued: { $sum: { $cond: [{ $eq: ["$queueStatus", "queued"] }, 1, 0] } },
          paused: { $sum: { $cond: [{ $eq: ["$queueStatus", "paused"] }, 1, 0] } },
          processing: { $sum: { $cond: [{ $eq: ["$queueStatus", "processing"] }, 1, 0] } },
          accepted: { $sum: { $cond: [{ $eq: ["$queueStatus", "accepted"] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["sent", "delivered", "read"]] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $in: ["$deliveryStatus", ["delivered", "read"]] }, 1, 0] } },
          read: { $sum: { $cond: [{ $eq: ["$deliveryStatus", "read"] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $and: [{ $ne: ["$queueStatus", "excluded"] }, { $or: [{ $eq: ["$queueStatus", "failed"] }, { $eq: ["$deliveryStatus", "failed"] }] }] }, 1, 0] } }
        }
      }
    ])
  ]);
  if (!campaign) return null;
  const counts = rows[0] ?? { total: 0, eligible: 0, excluded: 0, queued: 0, paused: 0, processing: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  const done = campaign.dispatchStatus === "completed" &&
    counts.queued === 0 &&
    counts.processing === 0 &&
    ["Queued", "Processing"].includes(campaign.status);
  const updated = await Campaign.findOneAndUpdate(
    done
      ? { _id: campaignId, status: { $in: ["Queued", "Processing"] }, dispatchStatus: "completed" }
      : { _id: campaignId },
    {
      $set: {
        queuedCount: counts.queued,
        processingCount: counts.processing,
        totalRecipients: counts.total,
        eligibleRecipients: counts.eligible,
        excludedRecipients: counts.excluded,
        acceptedCount: counts.accepted,
        pausedCount: counts.paused,
        sentCount: counts.sent,
        deliveredCount: counts.delivered,
        readCount: counts.read,
        failedCount: counts.failed,
        ...(done ? { status: "Completed", completedAt: new Date() } : {})
      }
    },
    { new: true }
  ).lean();
  return updated ?? Campaign.findById(campaignId).lean();
}
