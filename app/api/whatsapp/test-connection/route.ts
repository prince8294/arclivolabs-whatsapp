import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { rateLimit } from "@/lib/api/rate-limit";
import { getEffectiveCredentials, getStoredConnection, saveVerifiedConnection, markConnectionError } from "@/lib/whatsapp/config";
import { whatsappApiError } from "@/lib/whatsapp/errors";
import { MetaApiError, verifyMetaConnection } from "@/lib/whatsapp/meta";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const limited = rateLimit(request, "whatsapp-test-connection", 10);
  if (limited) return limited;

  try {
    const stored = await getStoredConnection();
    if (!stored || stored.status !== "connected") {
      return NextResponse.json(
        { error: { code: "NOT_CONNECTED", message: "Connect WhatsApp before testing the connection." } },
        { status: 409 }
      );
    }
    const { credentials } = await getEffectiveCredentials();
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
    if (error instanceof Error && error.message.startsWith("Stored WhatsApp credentials cannot be decrypted.")) {
      await markConnectionError(error.message);
    }
    return whatsappApiError(error);
  }
}
