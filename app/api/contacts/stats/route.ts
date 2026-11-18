import { NextRequest, NextResponse } from "next/server";
import { contactServerError } from "@/lib/api/contact-errors";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import { getContactStats } from "@/lib/data/contact-stats";

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  try {
    await connectToDatabase();
    return NextResponse.json({ stats: await getContactStats() });
  } catch (error) {
    return contactServerError(error);
  }
}
