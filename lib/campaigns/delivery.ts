import CampaignRecipient from "@/lib/models/campaign-recipient";
import WhatsAppMessage from "@/lib/models/whatsapp-message";
import { refreshCampaignCounts } from "@/lib/campaigns/counts";

const statusRanks: Record<string, number> = {
  accepted: 0,
  sent: 1,
  failed: 2,
  delivered: 2,
  read: 3
};

export async function applyCampaignDeliveryStatus(
  recipientId: string,
  status: string,
  failureCode = "",
  failureMessage = ""
) {
  const rank = statusRanks[status];
  if (rank === undefined) return;
  const prior = await CampaignRecipient.findOneAndUpdate(
    {
      _id: recipientId,
      $or: [
        { deliveryRank: { $lt: rank } },
        { deliveryStatus: "failed", deliveryRank: { $lte: rank } }
      ]
    },
    {
      $set: {
        deliveryStatus: status,
        deliveryRank: rank,
        updatedStatusAt: new Date(),
        ...(status === "failed" ? { errorCode: failureCode, errorMessage: failureMessage } : {})
      }
    },
    { new: false }
  ).select("+deliveryRank").lean();
  if (prior) await refreshCampaignCounts(prior.campaignId.toString());
}

export async function applyMessageDeliveryStatus(
  messageId: string,
  status: string,
  failureCode = "",
  failureMessage = ""
) {
  const rank = statusRanks[status];
  if (rank === undefined) return;
  await WhatsAppMessage.updateOne(
    {
      messageId,
      $or: [
        { statusRank: { $lt: rank } },
        { status: "failed", statusRank: { $lte: rank } }
      ]
    },
    {
      $set: {
        status,
        statusRank: rank,
        ...(status === "failed" ? { failureCode, failureMessage } : {})
      }
    }
  );
  const message = await WhatsAppMessage.findOne({ messageId }).select("campaignRecipientId").lean();
  const recipient = message?.campaignRecipientId
    ? await CampaignRecipient.findById(message.campaignRecipientId).select("_id").lean()
    : await CampaignRecipient.findOne({ whatsappMessageId: messageId }).select("_id").lean();
  if (recipient) await applyCampaignDeliveryStatus(String(recipient._id), status, failureCode, failureMessage);
}
