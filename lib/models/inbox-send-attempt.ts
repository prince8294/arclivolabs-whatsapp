import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const inboxSendAttemptSchema = new Schema(
  {
    requestId: { type: String, required: true, unique: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true, index: true },
    type: { type: String, enum: ["text", "template"], required: true },
    status: { type: String, enum: ["pending", "accepted", "uncertain", "failed", "reviewed"], default: "pending", index: true },
    messageId: { type: String, default: "" },
    errorCode: { type: String, default: "", maxlength: 100 },
    errorMessage: { type: String, default: "", maxlength: 1000 }
  },
  { timestamps: true }
);

export type InboxSendAttemptDocument = InferSchemaType<typeof inboxSendAttemptSchema>;

const InboxSendAttempt =
  (mongoose.models.InboxSendAttempt as Model<InboxSendAttemptDocument> | undefined) ??
  mongoose.model<InboxSendAttemptDocument>("InboxSendAttempt", inboxSendAttemptSchema);

export default InboxSendAttempt;
