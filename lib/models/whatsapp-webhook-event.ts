import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const webhookEventSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
    processedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

webhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export type WhatsAppWebhookEventDocument = InferSchemaType<typeof webhookEventSchema>;

const WhatsAppWebhookEvent =
  (mongoose.models.WhatsAppWebhookEvent as Model<WhatsAppWebhookEventDocument> | undefined) ??
  mongoose.model<WhatsAppWebhookEventDocument>("WhatsAppWebhookEvent", webhookEventSchema);

export default WhatsAppWebhookEvent;
