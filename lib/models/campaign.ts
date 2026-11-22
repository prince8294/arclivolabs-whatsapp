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
    templateName: { type: String, default: "", maxlength: 512 },
    templateLanguage: { type: String, default: "", maxlength: 20 },
    templateCategory: { type: String, default: "", maxlength: 40 },
    templateBody: { type: String, default: "", maxlength: 1024 },
    templateHeader: { type: String, default: "", maxlength: 60 },
    templateHeaderFormat: { type: String, enum: ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"], default: "NONE" },
    templateHeaderMediaUrl: { type: String, default: "", maxlength: 5000 },
    templateFooter: { type: String, default: "", maxlength: 60 },
    templateButtons: { type: [Schema.Types.Mixed], default: [] },
    variableMappings: { type: [variableMappingSchema], default: [] },
    status: {
      type: String,
      enum: ["Draft", "Queued", "Processing", "Paused", "Completed", "Cancelled", "Failed"],
      default: "Draft",
      index: true
    },
    startClaimToken: { type: String, default: "", select: false },
    dispatchVersion: { type: Number, default: 1 },
    dispatchStatus: { type: String, enum: ["pending", "processing", "completed", "failed"], default: "pending" },
    queueConfirmedAt: { type: Date, default: null },
    errorCode: { type: String, default: "", maxlength: 100 },
    errorMessage: { type: String, default: "", maxlength: 1000 },
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
