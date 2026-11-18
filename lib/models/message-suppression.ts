import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const messageSuppressionSchema = new Schema(
  {
    phoneNumber: { type: String, required: true, unique: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", default: null },
    reason: { type: String, default: "Opted Out", maxlength: 120 },
    source: { type: String, default: "Contact consent", maxlength: 120 },
    suppressedAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

export type MessageSuppressionDocument = InferSchemaType<typeof messageSuppressionSchema>;

const MessageSuppression =
  (mongoose.models.MessageSuppression as Model<MessageSuppressionDocument> | undefined) ??
  mongoose.model<MessageSuppressionDocument>("MessageSuppression", messageSuppressionSchema);

export default MessageSuppression;
