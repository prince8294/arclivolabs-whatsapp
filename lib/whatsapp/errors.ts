import { NextResponse } from "next/server";
import { MetaApiError } from "@/lib/whatsapp/meta";

export function whatsappApiError(error: unknown) {
  if (error instanceof MetaApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.httpStatus }
    );
  }

  const message =
    error instanceof Error &&
    (error.message === "WhatsApp integration is not configured." ||
      error.message.startsWith("Stored WhatsApp credentials cannot be decrypted."))
      ? error.message
      : "WhatsApp integration is temporarily unavailable.";
  return NextResponse.json(
    { error: { code: "WHATSAPP_UNAVAILABLE", message } },
    { status: 503 }
  );
}
