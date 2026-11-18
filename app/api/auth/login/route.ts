import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rate-limit";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionMaxAge,
  createAdminSession,
  isAdminConfigured,
  isSameOriginRequest,
  verifyAdminCredentials
} from "@/lib/auth/admin-session";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: { code: "AUTH_NOT_CONFIGURED", message: "Configure ADMIN_EMAIL, ADMIN_PASSWORD, and AUTH_SECRET on the server." } },
      { status: 503 }
    );
  }
  const limited = rateLimit(request, "admin-login", 10);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }

  const values = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const email = typeof values.email === "string" ? values.email : "";
  if (!verifyAdminCredentials(email, values.password)) {
    return NextResponse.json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } }, { status: 401 });
  }

  const session = createAdminSession(email);
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: adminSessionMaxAge,
    expires: new Date(session.expiresAt * 1000)
  });
  return response;
}
