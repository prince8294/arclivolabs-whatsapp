import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const configured = process.env.META_CREDENTIALS_ENCRYPTION_KEY;
  if (!configured) {
    throw new Error("META_CREDENTIALS_ENCRYPTION_KEY is not configured.");
  }
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new Error("META_CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function assertEncryptionConfigured() {
  encryptionKey();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string) {
  const [version, ivValue, tagValue, dataValue, extra] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !dataValue || extra !== undefined) {
    throw new Error("Stored Meta credentials are invalid.");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
