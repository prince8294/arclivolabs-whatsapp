import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";
import Conversation from "@/lib/models/conversation";

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const active = { isLeadActive: { $ne: false } };
    const [interestedLeads, followUpsPending, closedLeads, recent] = await Promise.all([
      Conversation.countDocuments({ ...active, leadStatus: "Interested" }),
      Conversation.countDocuments({ ...active, followUpStatus: "Pending" }),
      Conversation.countDocuments({ ...active, leadStatus: "Closed" }),
      Conversation.find({ ...active, leadStatus: "Interested" }).sort({ lastMessageAt: -1, _id: -1 }).limit(5).lean()
    ]);
    const contacts = await Contact.find({
      $or: [
        { _id: { $in: recent.map((lead) => lead.contactId).filter(Boolean) } },
        { phoneNumber: { $in: recent.map((lead) => lead.phoneNumber) } }
      ]
    }).select("businessName contactPerson phoneNumber categoryId").lean();
    const categories = await Category.find({
      _id: { $in: contacts.map((contact) => contact.categoryId) }
    }).select("name").lean();
    const contactById = new Map(contacts.map((contact) => [String(contact._id), contact]));
    const contactByPhone = new Map(contacts.map((contact) => [contact.phoneNumber, contact]));
    const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));
    return NextResponse.json({
      interestedLeads,
      followUpsPending,
      closedLeads,
      recentInterestedBusinesses: recent.map((lead) => {
        const contact = (lead.contactId && contactById.get(String(lead.contactId))) || contactByPhone.get(lead.phoneNumber);
        return {
          _id: String(lead._id),
          businessName: contact?.businessName || lead.businessName || contact?.contactPerson || lead.contactName || lead.phoneNumber,
          categoryName: contact ? categoryNames.get(String(contact.categoryId)) ?? "" : "",
          phoneNumber: lead.phoneNumber,
          lastActivityAt: lead.lastMessageAt?.toISOString() ?? null
        };
      })
    });
  } catch (error) {
    console.error("Lead statistics could not be loaded.", error);
    return NextResponse.json({ error: { code: "LEADS_STATS_FAILED", message: "Lead statistics could not be loaded." } }, { status: 500 });
  }
}
