import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { getStoredConnection, publicStatus } from "@/lib/whatsapp/config";
import { whatsappApiError } from "@/lib/whatsapp/errors";

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }

  try {
    return NextResponse.json({ status: publicStatus(await getStoredConnection()) });
  } catch (error) {
    return whatsappApiError(error);
  }
}
