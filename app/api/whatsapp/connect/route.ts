import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { rateLimit } from "@/lib/api/rate-limit";
import { getEffectiveCredentials, getStoredConnection, credentialsFromInput, saveVerifiedConnection, validateCredentials, markConnectionError } from "@/lib/whatsapp/config";
import { whatsappApiError } from "@/lib/whatsapp/errors";
import { MetaApiError, verifyMetaConnection } from "@/lib/whatsapp/meta";
import { assertEncryptionConfigured } from "@/lib/whatsapp/secrets";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const limited = rateLimit(request, "whatsapp-connect", 10);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: { code: "INVALID_CONFIGURATION", message: "WhatsApp configuration must be an object." } }, { status: 400 });
  }
  const values = body as Record<string, unknown>;
  const fields = ["wabaId", "phoneNumberId", "graphApiVersion", "accessToken", "appSecret", "verifyToken"];
  if (fields.some((field) => values[field] !== undefined && typeof values[field] !== "string")) {
    return NextResponse.json({ error: { code: "INVALID_CONFIGURATION", message: "Configuration fields must be text." } }, { status: 400 });
  }

  try {
    const allSupplied = fields.every((field) => typeof values[field] === "string" && (values[field] as string).trim());
    const priorCredentials = allSupplied ? null : (await getEffectiveCredentials()).credentials;
    const credentials = credentialsFromInput(values, priorCredentials);
    const validationError = validateCredentials(credentials);
    if (validationError) {
      return NextResponse.json({ error: { code: "INVALID_CONFIGURATION", message: validationError } }, { status: 400 });
    }

    assertEncryptionConfigured();
    const account = await verifyMetaConnection(credentials);
    await saveVerifiedConnection(credentials, account);
    const connection = await getStoredConnection();
    return NextResponse.json({ status: connection ? {
      status: connection.status,
      wabaId: connection.wabaId,
      phoneNumberId: connection.phoneNumberId,
      graphApiVersion: connection.graphApiVersion,
      displayName: connection.displayName,
      displayPhoneNumber: connection.displayPhoneNumber,
      lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
      lastError: "",
      configured: true
    } : null });
  } catch (error) {
    if (error instanceof MetaApiError) {
      await markConnectionError(error.message);
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.httpStatus }
      );
    }
    return whatsappApiError(error);
  }
}
