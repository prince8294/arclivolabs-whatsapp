import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Contact from "@/lib/models/contact";

function escapedRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }

  const search = (request.nextUrl.searchParams.get("search") ?? "").trim().slice(0, 100);
  try {
    await connectToDatabase();
    const filter: Record<string, unknown> = {
      marketingConsentStatus: "Opted In",
      consentSource: { $ne: "" },
      consentTimestamp: { $ne: null }
    };
    if (search) {
      const regex = new RegExp(escapedRegex(search), "i");
      filter.$or = [{ businessName: regex }, { phoneNumber: regex }];
    }
    const contacts = await Contact.find(filter)
      .select("businessName phoneNumber")
      .sort({ businessName: 1 })
      .limit(50)
      .lean();
    return NextResponse.json({
      contacts: contacts.map((contact) => ({
        id: contact._id.toString(),
        businessName: contact.businessName,
        phoneNumber: contact.phoneNumber
      }))
    });
  } catch {
    return NextResponse.json(
      { error: { code: "CONTACT_LOOKUP_FAILED", message: "Could not load eligible test recipients." } },
      { status: 503 }
    );
  }
}
