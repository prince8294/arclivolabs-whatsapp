import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const whatsappConnectionSchema = new Schema(
  {
    key: { type: String, unique: true, required: true, default: "primary" },
    wabaId: { type: String, default: "" },
    phoneNumberId: { type: String, default: "" },
    graphApiVersion: { type: String, default: "" },
    encryptedAccessToken: { type: String, default: "", select: false },
    encryptedAppSecret: { type: String, default: "", select: false },
    encryptedVerifyToken: { type: String, default: "", select: false },
    status: { type: String, enum: ["connected", "error"], required: true, default: "error" },
    displayName: { type: String, default: "" },
    displayPhoneNumber: { type: String, default: "" },
    lastError: { type: String, default: "" },
    lastVerifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export type WhatsAppConnectionDocument = InferSchemaType<typeof whatsappConnectionSchema>;

const WhatsAppConnection =
  (mongoose.models.WhatsAppConnection as Model<WhatsAppConnectionDocument> | undefined) ??
  mongoose.model<WhatsAppConnectionDocument>("WhatsAppConnection", whatsappConnectionSchema);

export default WhatsAppConnection;
