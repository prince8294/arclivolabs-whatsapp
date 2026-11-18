import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_SESSION_COOKIE = "arclivo_admin_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12;

function getCredentials() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!email || !password || !secret || secret.length < 32) return null;
  return { email: email.toLowerCase(), password, secret };
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isAdminConfigured() {
  return getCredentials() !== null;
}

export function verifyAdminCredentials(email: unknown, password: unknown) {
  const credentials = getCredentials();
  if (!credentials || typeof email !== "string" || typeof password !== "string") return false;
  return (
    safeEqual(email.trim().toLowerCase(), credentials.email) &&
    safeEqual(password, credentials.password)
  );
}

export function createAdminSession(email: string) {
  const credentials = getCredentials();
  if (!credentials) throw new Error("Admin authentication is not configured.");

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const payload = Buffer.from(JSON.stringify({ email: email.toLowerCase(), expiresAt })).toString("base64url");
  return { value: `${payload}.${sign(payload, credentials.secret)}`, expiresAt };
}

export function isAdminSessionValid(request: NextRequest) {
  const credentials = getCredentials();
  if (!credentials) return false;

  const value = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!value) return false;

  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return false;
  if (!safeEqual(signature, sign(payload, credentials.secret))) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
      expiresAt?: unknown;
    };
    return (
      typeof session.email === "string" &&
      safeEqual(session.email, credentials.email) &&
      typeof session.expiresAt === "number" &&
      session.expiresAt > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

export function isSameOriginRequest(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export const adminSessionMaxAge = SESSION_DURATION_SECONDS;
