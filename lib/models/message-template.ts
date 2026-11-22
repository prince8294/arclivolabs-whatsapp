import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const buttonSchema = new Schema(
  {
    type: { type: String, enum: ["QUICK_REPLY", "URL"], required: true },
    text: { type: String, required: true, trim: true, maxlength: 25 },
    url: { type: String, trim: true, maxlength: 2000, default: "" }
  },
  { _id: false }
);

const variableMappingSchema = new Schema(
  {
    number: { type: Number, required: true, min: 1 },
    mapping: { type: String, enum: ["contactPerson", "businessName", "city", ""], default: "" }
  },
  { _id: false }
);

const messageTemplateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9_]{1,512}$/ },
    businessCategoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    metaCategory: { type: String, required: true, default: "MARKETING" },
    language: { type: String, required: true, trim: true, maxlength: 20 },
    header: { type: String, default: "", trim: true, maxlength: 60 },
    headerFormat: { type: String, enum: ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"], default: "NONE" },
    headerMediaUrl: { type: String, default: "", maxlength: 5000 },
    body: { type: String, required: true, trim: true, maxlength: 1024 },
    footer: { type: String, default: "", trim: true, maxlength: 60 },
    buttons: { type: [buttonSchema], default: [] },
    variables: { type: [Number], default: [] },
    variableSamples: { type: Map, of: String, default: {} },
    variableMappings: { type: [variableMappingSchema], default: [] },
    metaTemplateId: { type: String, default: "", index: true },
    metaStatus: { type: String, default: "" },
    isDraft: { type: Boolean, default: true, index: true },
    rejectionReason: { type: String, default: "", maxlength: 2000 },
    lastSyncedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

messageTemplateSchema.index({ name: 1, language: 1 }, { unique: true });

export type MessageTemplateDocument = InferSchemaType<typeof messageTemplateSchema>;

const MessageTemplate =
  (mongoose.models.MessageTemplate as Model<MessageTemplateDocument> | undefined) ??
  mongoose.model<MessageTemplateDocument>("MessageTemplate", messageTemplateSchema);

export default MessageTemplate;
