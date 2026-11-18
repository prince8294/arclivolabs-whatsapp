import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const conversationSchema = new Schema(
  {
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
    phoneNumber: { type: String, required: true, trim: true },
    businessName: { type: String, default: "", trim: true, maxlength: 160 },
    contactName: { type: String, default: "", trim: true, maxlength: 160 },
    lastMessage: { type: String, default: "", maxlength: 4096 },
    lastMessageAt: { type: Date, default: null },
    lastIncomingMessageAt: { type: Date, default: null },
    lastReadAt: { type: Date, default: null },
    unreadCount: { type: Number, default: 0, min: 0 },
    leadStatus: {
      type: String,
      enum: ["New", "Interested", "Not Interested", "Closed"],
      default: "New",
      index: true
    },
    leadStatusUpdatedAt: { type: Date, default: null },
    isLeadActive: { type: Boolean, default: true, index: true },
    followUpStatus: {
      type: String,
      enum: ["Not Required", "Pending", "Completed"],
      default: "Not Required",
      index: true
    },
    followUpDate: { type: Date, default: null, index: true },
    followUpNotes: { type: String, default: "", maxlength: 2000 },
    lastContactedAt: { type: Date, default: null },
    notes: { type: String, default: "", maxlength: 2000 }
  },
  { timestamps: true }
);

conversationSchema.index({ phoneNumber: 1 }, { unique: true });
conversationSchema.index({ lastMessageAt: -1, _id: -1 });
conversationSchema.index({ unreadCount: 1, lastMessageAt: -1 });
conversationSchema.index({ leadStatus: 1, lastMessageAt: -1 });
conversationSchema.index({ isLeadActive: 1, leadStatus: 1, lastMessageAt: -1 });
conversationSchema.index({ isLeadActive: 1, followUpStatus: 1, followUpDate: 1 });

export type ConversationDocument = InferSchemaType<typeof conversationSchema>;

const Conversation =
  (mongoose.models.Conversation as Model<ConversationDocument> | undefined) ??
  mongoose.model<ConversationDocument>("Conversation", conversationSchema);

export default Conversation;
