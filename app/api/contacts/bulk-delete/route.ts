import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { contactServerError } from "@/lib/api/contact-errors";
import { rateLimit } from "@/lib/api/rate-limit";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Contact from "@/lib/models/contact";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const limited = rateLimit(request, "contact-bulk-delete", 10);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  const ids = body && typeof body === "object" ? (body as Record<string, unknown>).ids : null;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== "string" || !Types.ObjectId.isValid(id))
  ) {
    return NextResponse.json(
      { error: { code: "INVALID_IDS", message: "Select between 1 and 100 valid contacts." } },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();
    const result = await Contact.deleteMany({ _id: { $in: ids.map((id) => new Types.ObjectId(id as string)) } });
    return NextResponse.json({ deleted: result.deletedCount });
  } catch (error) {
    return contactServerError(error);
  }
}
