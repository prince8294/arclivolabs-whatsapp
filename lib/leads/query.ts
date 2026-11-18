import { Types } from "mongoose";
import Contact from "@/lib/models/contact";

export const leadStatuses = ["New", "Interested", "Not Interested", "Closed"] as const;
export const followUpStatuses = ["Not Required", "Pending", "Completed"] as const;

export type LeadFilters = {
  search: string;
  categoryId: string;
  city: string;
  leadStatus: string;
  followUpStatus: string;
  sortBy: "lastActivity" | "followUpDate";
  sortOrder: 1 | -1;
};

function escapedRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseLeadFilters(params: URLSearchParams):
  | { ok: true; value: LeadFilters }
  | { ok: false; message: string } {
  const search = (params.get("search") ?? "").trim().slice(0, 100);
  const categoryId = (params.get("categoryId") ?? "").trim();
  const city = (params.get("city") ?? "").trim().slice(0, 100);
  const leadStatus = (params.get("leadStatus") ?? "Interested").trim();
  const followUpStatus = (params.get("followUpStatus") ?? "all").trim();
  const sortBy = params.get("sortBy") === "followUpDate" ? "followUpDate" : "lastActivity";
  const sortOrder = params.get("sortOrder") === "asc" ? 1 : -1;
  if (categoryId && !Types.ObjectId.isValid(categoryId)) return { ok: false, message: "Category filter is invalid." };
  if (leadStatus !== "all" && !leadStatuses.includes(leadStatus as (typeof leadStatuses)[number])) {
    return { ok: false, message: "Lead status filter is invalid." };
  }
  if (followUpStatus !== "all" && !followUpStatuses.includes(followUpStatus as (typeof followUpStatuses)[number])) {
    return { ok: false, message: "Follow-up status filter is invalid." };
  }
  return { ok: true, value: { search, categoryId, city, leadStatus, followUpStatus, sortBy, sortOrder } };
}

export async function buildLeadCriteria(filters: LeadFilters) {
  const clauses: Record<string, unknown>[] = [];
  if (filters.leadStatus !== "all") clauses.push({ leadStatus: filters.leadStatus });
  if (filters.followUpStatus === "Not Required") {
    clauses.push({ $or: [{ followUpStatus: "Not Required" }, { followUpStatus: { $exists: false } }] });
  } else if (filters.followUpStatus !== "all") {
    clauses.push({ followUpStatus: filters.followUpStatus });
  }

  const contactFilter: Record<string, unknown> = {};
  if (filters.categoryId) contactFilter.categoryId = new Types.ObjectId(filters.categoryId);
  if (filters.city) contactFilter.city = filters.city;
  if (filters.search) {
    const regex = new RegExp(escapedRegex(filters.search), "i");
    contactFilter.$or = [
      { businessName: regex },
      { contactPerson: regex },
      { phoneNumber: regex }
    ];
  }
  const contacts = filters.categoryId || filters.city
    ? await Contact.find(contactFilter).select("_id phoneNumber").lean()
    : [];
  if (filters.categoryId || filters.city) {
    clauses.push({
      $or: [
        { contactId: { $in: contacts.map((contact) => contact._id) } },
        { phoneNumber: { $in: contacts.map((contact) => contact.phoneNumber) } }
      ]
    });
  } else if (filters.search) {
    const regex = new RegExp(escapedRegex(filters.search), "i");
    const matchingContacts = await Contact.find(contactFilter).select("_id phoneNumber").lean();
    clauses.push({
      $or: [
        { businessName: regex },
        { contactName: regex },
        { phoneNumber: regex },
        { contactId: { $in: matchingContacts.map((contact) => contact._id) } },
        { phoneNumber: { $in: matchingContacts.map((contact) => contact.phoneNumber) } }
      ]
    });
  }
  return { $and: [{ isLeadActive: { $ne: false } }, ...clauses] };
}

export function leadSort(filters: LeadFilters) {
  return filters.sortBy === "followUpDate"
    ? [["followUpDate", filters.sortOrder], ["lastMessageAt", -1], ["_id", -1]] as [string, 1 | -1][]
    : [["lastMessageAt", filters.sortOrder], ["_id", filters.sortOrder]] as [string, 1 | -1][];
}
