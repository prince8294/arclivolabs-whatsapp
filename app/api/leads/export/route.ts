import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import { buildLeadCriteria, leadSort, parseLeadFilters } from "@/lib/leads/query";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";
import Conversation from "@/lib/models/conversation";

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\t\r]/.test(text) || /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function dateOnly(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : "";
}

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const parsedFilters = parseLeadFilters(request.nextUrl.searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ error: { code: "INVALID_FILTER", message: parsedFilters.message } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    const criteria = await buildLeadCriteria(parsedFilters.value);
    const leads = await Conversation.find(criteria).sort(leadSort(parsedFilters.value)).lean();
    const contacts = await Contact.find({
      $or: [
        { _id: { $in: leads.map((lead) => lead.contactId).filter(Boolean) } },
        { phoneNumber: { $in: leads.map((lead) => lead.phoneNumber) } }
      ]
    }).select("businessName contactPerson phoneNumber categoryId city email").lean();
    const categories = await Category.find({ _id: { $in: contacts.map((contact) => contact.categoryId) } }).select("name").lean();
    const contactById = new Map(contacts.map((contact) => [String(contact._id), contact]));
    const contactByPhone = new Map(contacts.map((contact) => [contact.phoneNumber, contact]));
    const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));
    const rows = [
      ["Business Name", "Contact Person", "WhatsApp Number", "Category", "City", "Email", "Lead Status", "Follow-up Status", "Follow-up Date", "Notes"],
      ...leads.map((lead) => {
        const contact = (lead.contactId && contactById.get(String(lead.contactId))) || contactByPhone.get(lead.phoneNumber);
        return [
          contact?.businessName || lead.businessName || contact?.contactPerson || lead.contactName || lead.phoneNumber,
          contact?.contactPerson || lead.contactName || "",
          lead.phoneNumber,
          contact ? categoryNames.get(String(contact.categoryId)) ?? "" : "",
          contact?.city ?? "",
          contact?.email ?? "",
          lead.leadStatus ?? "New",
          lead.followUpStatus ?? "Not Required",
          dateOnly(lead.followUpDate),
          lead.notes ?? ""
        ];
      })
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="brand-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("Lead CSV could not be generated.", error);
    return NextResponse.json({ error: { code: "LEADS_EXPORT_FAILED", message: "Lead CSV could not be generated." } }, { status: 500 });
  }
}
