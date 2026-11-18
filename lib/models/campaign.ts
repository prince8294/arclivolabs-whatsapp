import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const variableMappingSchema = new Schema(
  {
    number: { type: Number, required: true, min: 1 },
    mapping: { type: String, enum: ["contactPerson", "businessName", "city"], required: true }
  },
  { _id: false }
);

const campaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", trim: true, maxlength: 1000 },
    categoryIds: { type: [Schema.Types.ObjectId], ref: "Category", default: [] },
    cities: { type: [String], default: [] },
    importBatchId: { type: String, default: "", index: true },
    messageMode: {
      type: String,
      enum: ["approved_template", "personalized_csv"],
      default: "approved_template",
      index: true
    },
    templateId: { type: Schema.Types.ObjectId, ref: "MessageTemplate", default: null },
    variableMappings: { type: [variableMappingSchema], default: [] },
    status: {
      type: String,
      enum: ["Draft", "Queued", "Processing", "Paused", "Completed", "Cancelled", "Failed"],
      default: "Draft",
      index: true
    },
    dispatchVersion: { type: Number, default: 1 },
    dispatchStatus: { type: String, enum: ["pending", "processing", "completed"], default: "pending" },
    totalRecipients: { type: Number, default: 0 },
    eligibleRecipients: { type: Number, default: 0 },
    excludedRecipients: { type: Number, default: 0 },
    queuedCount: { type: Number, default: 0 },
    pausedCount: { type: Number, default: 0 },
    processingCount: { type: Number, default: 0 },
    acceptedCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    readCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

campaignSchema.index({ createdAt: -1 });
campaignSchema.index({ importBatchId: 1, createdAt: -1 });

export type CampaignDocument = InferSchemaType<typeof campaignSchema>;

const Campaign =
  (mongoose.models.Campaign as Model<CampaignDocument> | undefined) ??
  mongoose.model<CampaignDocument>("Campaign", campaignSchema);

export default Campaign;
