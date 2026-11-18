import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const testAttemptSchema = new Schema(
  {
    requestId: { type: String, required: true, unique: true },
    status: { type: String, enum: ["pending", "accepted", "failed"], required: true },
    messageId: { type: String, default: "" },
    errorCode: { type: String, default: "" },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true }
  },
  { timestamps: true }
);

export type WhatsAppTestAttemptDocument = InferSchemaType<typeof testAttemptSchema>;

const WhatsAppTestAttempt =
  (mongoose.models.WhatsAppTestAttempt as Model<WhatsAppTestAttemptDocument> | undefined) ??
  mongoose.model<WhatsAppTestAttemptDocument>("WhatsAppTestAttempt", testAttemptSchema);

export default WhatsAppTestAttempt;
