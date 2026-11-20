import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const campaignRecipientReservationSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, unique: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    campaignRecipientId: { type: Schema.Types.ObjectId, ref: "CampaignRecipient", required: true },
    reservedAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

export type CampaignRecipientReservationDocument = InferSchemaType<typeof campaignRecipientReservationSchema>;

const CampaignRecipientReservation =
  (mongoose.models.CampaignRecipientReservation as Model<CampaignRecipientReservationDocument> | undefined) ??
  mongoose.model<CampaignRecipientReservationDocument>("CampaignRecipientReservation", campaignRecipientReservationSchema);

export default CampaignRecipientReservation;
