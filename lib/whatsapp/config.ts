import WhatsAppConnection from "@/lib/models/whatsapp-connection";
import { connectToDatabase } from "@/lib/db/mongodb";
import { decryptSecret, encryptSecret } from "@/lib/whatsapp/secrets";

export type MetaWhatsAppCredentials = {
  wabaId: string;
  phoneNumberId: string;
  graphApiVersion: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
};

export type PublicWhatsAppStatus = {
  status: "not_connected" | "connected" | "error";
  wabaId: string;
  phoneNumberId: string;
  graphApiVersion: string;
  displayName: string;
  displayPhoneNumber: string;
  lastVerifiedAt: string | null;
  lastError: string;
  configured: boolean;
};

export function getEnvironmentCredentials(): MetaWhatsAppCredentials {
  return {
    wabaId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() ?? "",
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "",
    graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim() ?? "",
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() ?? "",
    appSecret: process.env.META_APP_SECRET?.trim() ?? "",
    verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN?.trim() ?? ""
  };
}

export function validateCredentials(credentials: MetaWhatsAppCredentials) {
  if (!/^\d{5,30}$/.test(credentials.wabaId)) return "Enter a valid WhatsApp Business Account ID.";
  if (!/^\d{5,30}$/.test(credentials.phoneNumberId)) return "Enter a valid Phone Number ID.";
  if (!/^v\d+\.\d+$/.test(credentials.graphApiVersion)) return "Graph API Version must use the format vNN.N.";
  if (!credentials.accessToken || credentials.accessToken.length > 8192) return "Enter a valid Meta access token.";
  if (!credentials.appSecret || credentials.appSecret.length < 16 || credentials.appSecret.length > 1024) return "Enter a valid Meta app secret.";
  if (!credentials.verifyToken || credentials.verifyToken.length < 16 || credentials.verifyToken.length > 256) {
    return "Webhook verify token must be between 16 and 256 characters.";
  }
  return null;
}

export async function getStoredConnection(includeSecrets = false) {
  await connectToDatabase();
  const query = WhatsAppConnection.findOne({ key: "primary" });
  if (includeSecrets) {
    query.select("+encryptedAccessToken +encryptedAppSecret +encryptedVerifyToken");
  }
  return query.lean();
}

export async function getEffectiveCredentials() {
  const connection = await getStoredConnection(true);
  if (!connection || !connection.encryptedAccessToken || !connection.encryptedAppSecret || !connection.encryptedVerifyToken) {
    const envCredentials = getEnvironmentCredentials();
    const error = validateCredentials(envCredentials);
    if (error) {
      throw new Error("WhatsApp integration is not configured.");
    }
    return { credentials: envCredentials, connection };
  }

  try {
    const credentials = {
      wabaId: connection.wabaId,
      phoneNumberId: connection.phoneNumberId,
      graphApiVersion: connection.graphApiVersion,
      accessToken: decryptSecret(connection.encryptedAccessToken),
      appSecret: decryptSecret(connection.encryptedAppSecret),
      verifyToken: decryptSecret(connection.encryptedVerifyToken)
    };
    if (validateCredentials(credentials)) {
      throw new Error("Stored WhatsApp credentials are incomplete.");
    }
    return { credentials, connection };
  } catch {
    throw new Error("Stored WhatsApp credentials cannot be decrypted. Replace the credentials using the configured encryption key.");
  }
}

export function credentialsFromInput(body: Record<string, unknown>, existing?: MetaWhatsAppCredentials | null) {
  const environment = getEnvironmentCredentials();
  const pick = (key: keyof MetaWhatsAppCredentials) => {
    const supplied = body[key];
    if (typeof supplied === "string" && supplied.trim()) return supplied.trim();
    return existing?.[key] || environment[key];
  };

  return {
    wabaId: pick("wabaId"),
    phoneNumberId: pick("phoneNumberId"),
    graphApiVersion: pick("graphApiVersion"),
    accessToken: pick("accessToken"),
    appSecret: pick("appSecret"),
    verifyToken: pick("verifyToken")
  };
}

export async function saveVerifiedConnection(
  credentials: MetaWhatsAppCredentials,
  account: { displayName: string; displayPhoneNumber: string }
) {
  await connectToDatabase();
  return WhatsAppConnection.findOneAndUpdate(
    { key: "primary" },
    {
      $set: {
        wabaId: credentials.wabaId,
        phoneNumberId: credentials.phoneNumberId,
        graphApiVersion: credentials.graphApiVersion,
        encryptedAccessToken: encryptSecret(credentials.accessToken),
        encryptedAppSecret: encryptSecret(credentials.appSecret),
        encryptedVerifyToken: encryptSecret(credentials.verifyToken),
        status: "connected",
        displayName: account.displayName,
        displayPhoneNumber: account.displayPhoneNumber,
        lastError: "",
        lastVerifiedAt: new Date()
      },
      $setOnInsert: { key: "primary" }
    },
    { upsert: true, new: true, runValidators: true }
  );
}

export async function markConnectionError(message: string) {
  await connectToDatabase();
  await WhatsAppConnection.updateOne(
    { key: "primary" },
    { $set: { status: "error", lastError: message }, $setOnInsert: { key: "primary" } },
    { upsert: true }
  );
}

export function publicStatus(connection: Awaited<ReturnType<typeof getStoredConnection>>): PublicWhatsAppStatus {
  const environment = getEnvironmentCredentials();
  if (!connection) {
    const configured = validateCredentials(environment) === null;
    return {
      status: "not_connected",
      wabaId: configured ? environment.wabaId : "",
      phoneNumberId: configured ? environment.phoneNumberId : "",
      graphApiVersion: configured ? environment.graphApiVersion : "",
      displayName: "",
      displayPhoneNumber: "",
      lastVerifiedAt: null,
      lastError: "",
      configured
    };
  }
  const environmentConfigured = validateCredentials(environment) === null;
  const hasStoredAccount = Boolean(connection.wabaId && connection.phoneNumberId);
  return {
    status: connection.status,
    wabaId: connection.wabaId || (environmentConfigured ? environment.wabaId : ""),
    phoneNumberId: connection.phoneNumberId || (environmentConfigured ? environment.phoneNumberId : ""),
    graphApiVersion: connection.graphApiVersion || (environmentConfigured ? environment.graphApiVersion : ""),
    displayName: connection.displayName,
    displayPhoneNumber: connection.displayPhoneNumber,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastError: connection.lastError,
    configured: hasStoredAccount || environmentConfigured
  };
}
