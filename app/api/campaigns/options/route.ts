import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Contact from "@/lib/models/contact";
import { getStoredConnection } from "@/lib/whatsapp/config";

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const [cities, connection] = await Promise.all([
      Contact.distinct("city", { city: { $exists: true, $ne: "" } }),
      getStoredConnection()
    ]);
    return NextResponse.json({
      cities: (cities as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      whatsappStatus: connection?.status ?? "not_connected"
    });
  } catch (error) {
    console.error("Campaign options could not be loaded.", error);
    return NextResponse.json({ error: { code: "CAMPAIGN_OPTIONS_FAILED", message: "Campaign options could not be loaded." } }, { status: 500 });
  }
}
