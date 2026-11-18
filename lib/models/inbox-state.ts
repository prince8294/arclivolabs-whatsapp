import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const inboxStateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export type InboxStateDocument = InferSchemaType<typeof inboxStateSchema>;

const InboxState =
  (mongoose.models.InboxState as Model<InboxStateDocument> | undefined) ??
  mongoose.model<InboxStateDocument>("InboxState", inboxStateSchema);

export default InboxState;
