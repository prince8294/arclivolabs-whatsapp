import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import { buildLeadCriteria, leadSort, parseLeadFilters } from "@/lib/leads/query";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";
import Conversation from "@/lib/models/conversation";

function iso(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : null;
}

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const parsedFilters = parseLeadFilters(request.nextUrl.searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ error: { code: "INVALID_FILTER", message: parsedFilters.message } }, { status: 400 });
  }
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "20");
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return NextResponse.json({ error: { code: "INVALID_PAGINATION", message: "Page must be positive and page size must be from 1 to 100." } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    const criteria = await buildLeadCriteria(parsedFilters.value);
    const [leads, total, categories, cities] = await Promise.all([
      Conversation.find(criteria).sort(leadSort(parsedFilters.value)).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Conversation.countDocuments(criteria),
      Category.find().sort({ name: 1 }).select("name").lean(),
      Contact.distinct("city", { city: { $ne: "" } })
    ]);
    const contacts = await Contact.find({
      $or: [
        { _id: { $in: leads.map((lead) => lead.contactId).filter(Boolean) } },
        { phoneNumber: { $in: leads.map((lead) => lead.phoneNumber) } }
      ]
    }).select("businessName contactPerson phoneNumber categoryId city email").lean();
    const contactById = new Map(contacts.map((contact) => [String(contact._id), contact]));
    const contactByPhone = new Map(contacts.map((contact) => [contact.phoneNumber, contact]));
    const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));
    return NextResponse.json({
      leads: leads.map((lead) => {
        const contact = (lead.contactId && contactById.get(String(lead.contactId))) || contactByPhone.get(lead.phoneNumber);
        return {
          _id: String(lead._id),
          contactId: contact ? String(contact._id) : null,
          businessName: contact?.businessName || lead.businessName || contact?.contactPerson || lead.contactName || lead.phoneNumber,
          contactPerson: contact?.contactPerson || lead.contactName || "",
          phoneNumber: lead.phoneNumber,
          categoryId: contact ? String(contact.categoryId) : "",
          categoryName: contact ? categoryNames.get(String(contact.categoryId)) ?? "" : "",
          city: contact?.city ?? "",
          email: contact?.email ?? "",
          leadStatus: lead.leadStatus ?? "New",
          followUpStatus: lead.followUpStatus ?? "Not Required",
          followUpDate: iso(lead.followUpDate),
          followUpNotes: lead.followUpNotes ?? "",
          lastContactedAt: iso(lead.lastContactedAt ?? lead.lastMessageAt),
          lastActivityAt: iso(lead.lastMessageAt),
          notes: lead.notes ?? ""
        };
      }),
      categories: categories.map((category) => ({ _id: String(category._id), name: category.name })),
      cities: cities.filter((city): city is string => typeof city === "string").sort((left, right) => left.localeCompare(right)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error("Leads could not be loaded.", error);
    return NextResponse.json({ error: { code: "LEADS_LOAD_FAILED", message: "Leads could not be loaded." } }, { status: 500 });
  }
}
