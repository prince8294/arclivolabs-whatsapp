import { Types } from "mongoose";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import CampaignRecipientReservation from "@/lib/models/campaign-recipient-reservation";
import WhatsAppMessage from "@/lib/models/whatsapp-message";

export type RecipientReservationCandidate = {
  phoneNumber: string;
  campaignId: Types.ObjectId;
  campaignRecipientId: Types.ObjectId;
};

let reservationIndexReady: Promise<void> | null = null;

async function ensureReservationIndex() {
  if (!reservationIndexReady) {
    reservationIndexReady = CampaignRecipientReservation.createIndexes()
      .then(() => undefined)
      .catch((error: unknown) => {
        reservationIndexReady = null;
        throw error;
      });
  }
  await reservationIndexReady;
}

export async function findRecordedRecipients(phoneNumbers: string[], ignoreCampaignId?: Types.ObjectId) {
  const numbers = [...new Set(phoneNumbers)];
  if (!numbers.length) return new Map<string, { type: string; campaignId: string; recordId: string }>();

  const campaignFilter = ignoreCampaignId ? { campaignId: { $ne: ignoreCampaignId } } : {};
  const [recipients, messages, reservations] = await Promise.all([
    CampaignRecipient.find({ phoneNumber: { $in: numbers }, ...campaignFilter }).select("_id phoneNumber campaignId").lean(),
    WhatsAppMessage.find({ phoneNumber: { $in: numbers }, direction: "outgoing", ...campaignFilter })
      .select("_id messageId phoneNumber campaignId").lean(),
    CampaignRecipientReservation.find({ phoneNumber: { $in: numbers }, ...campaignFilter })
      .select("_id phoneNumber campaignId").lean()
  ]);
  const recorded = new Map<string, { type: string; campaignId: string; recordId: string }>();
  for (const reservation of reservations) {
    recorded.set(reservation.phoneNumber, {
      type: "already_reserved",
      campaignId: String(reservation.campaignId),
      recordId: String(reservation._id)
    });
  }
  for (const recipient of recipients) {
    if (!recorded.has(recipient.phoneNumber)) {
      recorded.set(recipient.phoneNumber, {
        type: "previous_campaign",
        campaignId: String(recipient.campaignId),
        recordId: String(recipient._id)
      });
    }
  }
  for (const message of messages) {
    if (!recorded.has(message.phoneNumber)) {
      recorded.set(message.phoneNumber, {
        type: "previous_message",
        campaignId: message.campaignId ? String(message.campaignId) : "",
        recordId: message.messageId || String(message._id)
      });
    }
  }
  return recorded;
}

export async function existingCampaignReservations(campaignId: Types.ObjectId, phoneNumbers: string[]) {
  const records = await CampaignRecipientReservation.find({
    campaignId,
    phoneNumber: { $in: [...new Set(phoneNumbers)] }
  }).select("phoneNumber campaignRecipientId").lean();
  return new Map(records.map((record) => [record.phoneNumber, record.campaignRecipientId]));
}

export async function reserveCampaignRecipients(candidates: RecipientReservationCandidate[]) {
  if (!candidates.length) return new Set<string>();
  await ensureReservationIndex();

  try {
    await CampaignRecipientReservation.bulkWrite(candidates.map((candidate) => ({
      updateOne: {
        filter: { phoneNumber: candidate.phoneNumber },
        update: { $setOnInsert: candidate },
        upsert: true
      }
    })), { ordered: false });
  } catch (error) {
    const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
    const writeErrors = record && Array.isArray(record.writeErrors) ? record.writeErrors : [];
    const onlyDuplicateKeys = record?.code === 11000 || (writeErrors.length > 0 && writeErrors.every((item) =>
      item && typeof item === "object" && "code" in item && item.code === 11000
    ));
    if (!onlyDuplicateKeys) throw error;
  }

  const reservations = await CampaignRecipientReservation.find({
    phoneNumber: { $in: [...new Set(candidates.map((candidate) => candidate.phoneNumber))] }
  }).select("campaignId campaignRecipientId").lean();
  const reservationsByRecipient = new Map(reservations.map((item) => [String(item.campaignRecipientId), item]));
  const owned = new Set<string>();
  for (const candidate of candidates) {
    const reservation = reservationsByRecipient.get(String(candidate.campaignRecipientId));
    if (reservation && reservation.campaignId.equals(candidate.campaignId)) {
      owned.add(String(candidate.campaignRecipientId));
    }
  }
  return owned;
}
