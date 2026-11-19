import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const campaignRecipientSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", default: null },
    importBatchId: { type: String, default: "", index: true },
    importRowNumber: { type: Number, default: null },
    phoneNumber: { type: String, required: true },
    businessName: { type: String, default: "" },
    contactPerson: { type: String, default: "" },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    categoryName: { type: String, default: "" },
    city: { type: String, default: "" },
    messageMode: {
      type: String,
      enum: ["approved_template", "personalized_csv"],
      default: "approved_template"
    },
    originalCsvMessage: { type: String, default: "", maxlength: 4096 },
    templateId: { type: Schema.Types.ObjectId, ref: "MessageTemplate", default: null },
    templateName: { type: String, default: "", maxlength: 512 },
    templateLanguage: { type: String, default: "", maxlength: 20 },
    templateCategory: { type: String, default: "", maxlength: 40 },
    templateVariables: { type: [String], default: [] },
    renderedMessage: { type: String, default: "", maxlength: 4096 },
    eligibilityStatus: {
      type: String,
      enum: ["Ready to Send", "Template Required", "Missing Consent", "Invalid Number", "Missing Variable", "Opted Out", "Duplicate Contact", "Suppressed", "Excluded"],
      default: "Ready to Send",
      index: true
    },
    exclusionReason: { type: String, default: "", maxlength: 1000 },
    whatsappMessageId: { type: String, default: "", index: true },
    queueStatus: {
      type: String,
      enum: ["queued", "processing", "accepted", "uncertain", "failed", "cancelled", "paused", "excluded"],
      default: "queued",
      index: true
    },
    deliveryStatus: {
      type: String,
      enum: ["pending", "accepted", "sent", "delivered", "read", "failed", "uncertain"],
      default: "pending",
      index: true
    },
    deliveryRank: { type: Number, default: 0, select: false },
    errorCode: { type: String, default: "", maxlength: 100 },
    errorMessage: { type: String, default: "", maxlength: 1000 },
    attemptCount: { type: Number, default: 0 },
    queueVersion: { type: Number, default: 1 },
    updatedStatusAt: { type: Date, default: null },
    sentTimestamp: { type: Date, default: null }
  },
  { timestamps: true }
);

campaignRecipientSchema.index({ campaignId: 1, contactId: 1 }, { unique: true });
campaignRecipientSchema.index(
  { campaignId: 1, importRowNumber: 1 },
  { unique: true, partialFilterExpression: { importRowNumber: { $type: "number" } } }
);
campaignRecipientSchema.index({ campaignId: 1, queueStatus: 1, createdAt: 1 });
campaignRecipientSchema.index({ campaignId: 1, deliveryStatus: 1 });
campaignRecipientSchema.index({ campaignId: 1, categoryId: 1, deliveryStatus: 1 });
campaignRecipientSchema.index({ campaignId: 1, eligibilityStatus: 1, categoryName: 1, city: 1 });

export type CampaignRecipientDocument = InferSchemaType<typeof campaignRecipientSchema>;

const CampaignRecipient =
  (mongoose.models.CampaignRecipient as Model<CampaignRecipientDocument> | undefined) ??
  mongoose.model<CampaignRecipientDocument>("CampaignRecipient", campaignRecipientSchema);

export default CampaignRecipient;
