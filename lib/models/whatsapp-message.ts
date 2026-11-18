import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const whatsappMessageSchema = new Schema(
  {
    messageId: { type: String, unique: true, sparse: true },
    requestId: { type: String, unique: true, sparse: true, select: false },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", default: null, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", default: null, index: true },
    campaignRecipientId: { type: Schema.Types.ObjectId, ref: "CampaignRecipient", default: null, index: true },
    whatsappContactId: { type: String, default: "" },
    phoneNumber: { type: String, default: "" },
    contactName: { type: String, default: "" },
    messageType: { type: String, required: true },
    content: { type: String, default: "" },
    metadata: { type: Schema.Types.Mixed, default: {} },
    messageTimestamp: { type: Date, default: null },
    direction: { type: String, enum: ["incoming", "outgoing"], required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "received", "sent", "delivered", "read", "failed"],
      required: true
    },
    statusRank: { type: Number, default: 0, select: false },
    failureCode: { type: String, default: "" },
    failureMessage: { type: String, default: "" },
    isReadInternally: { type: Boolean, default: false, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", default: null, index: true }
  },
  { timestamps: true, collection: "whatsappmessages" }
);

whatsappMessageSchema.index({ phoneNumber: 1, createdAt: -1 });
whatsappMessageSchema.index({ conversationId: 1, messageTimestamp: -1, _id: -1 });
whatsappMessageSchema.index({ conversationId: 1, direction: 1, isReadInternally: 1 });
whatsappMessageSchema.index({ direction: 1, status: 1, createdAt: -1 });
whatsappMessageSchema.index({ campaignId: 1, direction: 1, messageTimestamp: -1 });
whatsappMessageSchema.index({ campaignRecipientId: 1, direction: 1, messageTimestamp: -1 });

export type WhatsAppMessageDocument = InferSchemaType<typeof whatsappMessageSchema>;

const WhatsAppMessage =
  (mongoose.models.WhatsAppMessage as Model<WhatsAppMessageDocument> | undefined) ??
  mongoose.model<WhatsAppMessageDocument>("WhatsAppMessage", whatsappMessageSchema);

export default WhatsAppMessage;
