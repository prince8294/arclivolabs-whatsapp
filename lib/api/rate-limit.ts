import { NextRequest, NextResponse } from "next/server";

type WindowEntry = { count: number; resetAt: number };
const windows = new Map<string, WindowEntry>();

export function rateLimit(
  request: NextRequest,
  key: string,
  limit: number,
  windowMs = 60_000
): NextResponse | null {
  const now = Date.now();
  for (const [entryKey, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(entryKey);
  }

  const address = request.headers.get("x-real-ip") ?? "unknown";
  const bucketKey = `${key}:${address}`;
  const current = windows.get(bucketKey);
  if (!current || current.resetAt <= now) {
    windows.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (current.count >= limit) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests. Try again shortly." } },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((current.resetAt - now) / 1000)) }
      }
    );
  }

  current.count += 1;
  return null;
}
