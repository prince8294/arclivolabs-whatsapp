import { NextRequest, NextResponse } from "next/server";

const sessionCookie = "arclivo_admin_session";

function decodeBase64Url(value: string) {
  const rawBase64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const base64 = rawBase64.padEnd(Math.ceil(rawBase64.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hasValidAdminSession(request: NextRequest) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const secret = process.env.AUTH_SECRET;
  const value = request.cookies.get(sessionCookie)?.value;
  if (!email || !secret || secret.length < 32 || !value) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    if (!await crypto.subtle.verify("HMAC", key, decodeBase64Url(signature), new TextEncoder().encode(payload))) {
      return false;
    }
    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as {
      email?: unknown;
      expiresAt?: unknown;
    };
    return session.email === email &&
      typeof session.expiresAt === "number" &&
      session.expiresAt > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/login" || await hasValidAdminSession(request)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"]
};
