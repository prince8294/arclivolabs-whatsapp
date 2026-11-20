import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { marketingConsentStatuses } from "@/lib/contacts/validation";

const consentHistorySchema = new Schema(
  {
    status: { type: String, enum: [...marketingConsentStatuses], required: true },
    source: { type: String, required: true, maxlength: 120 },
    timestamp: { type: Date, required: true }
  },
  { _id: false }
);

const contactSchema = new Schema(
  {
    businessName: { type: String, required: true, trim: true, maxlength: 160 },
    contactPerson: { type: String, default: "", trim: true, maxlength: 120 },
    phoneNumber: { type: String, required: true, unique: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    city: { type: String, default: "", trim: true, maxlength: 100, index: true },
    state: { type: String, default: "", trim: true, maxlength: 100 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254 },
    notes: { type: String, default: "", trim: true, maxlength: 2000 },
    marketingConsentStatus: {
      type: String,
      enum: [...marketingConsentStatuses],
      default: "Unknown",
      required: true
    },
    consentSource: { type: String, default: "", trim: true, maxlength: 120 },
    consentTimestamp: { type: Date, default: null },
    consentHistory: { type: [consentHistorySchema], default: [] },
    doNotContact: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

contactSchema.index({ categoryId: 1, city: 1 });
contactSchema.index({ createdAt: -1 });

export type ContactDocument = InferSchemaType<typeof contactSchema>;

const Contact =
  (mongoose.models.Contact as Model<ContactDocument> | undefined) ??
  mongoose.model<ContactDocument>("Contact", contactSchema);

export default Contact;
