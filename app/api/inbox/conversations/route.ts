import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Category from "@/lib/models/category";
import Contact from "@/lib/models/contact";
import Conversation from "@/lib/models/conversation";
import InboxState from "@/lib/models/inbox-state";
import WhatsAppMessage from "@/lib/models/whatsapp-message";

function escapedRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asIso(value: Date | null | undefined) {
  return value instanceof Date ? value.toISOString() : null;
}

async function bootstrapStoredMessages() {
  const key = "stored-message-conversations-v1";
  if (await InboxState.exists({ key, completedAt: { $ne: null } })) return;

  const rows = await WhatsAppMessage.aggregate([
    { $match: { phoneNumber: { $ne: "" }, messageType: { $ne: "unknown" } } },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $group: {
        _id: "$phoneNumber",
        latest: { $first: "$$ROOT" },
        lastIncomingMessageAt: {
          $max: {
            $cond: [
              { $eq: ["$direction", "incoming"] },
              { $ifNull: ["$messageTimestamp", "$createdAt"] },
              null
            ]
          }
        },
        unreadCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$direction", "incoming"] }, { $ne: ["$isReadInternally", true] }] },
              1,
              0
            ]
          }
        }
      }
    }
  ]);
  const phones = rows.map((row) => row._id as string);
  const contacts = await Contact.find({ phoneNumber: { $in: phones } })
    .select("phoneNumber businessName contactPerson")
    .lean();
  const contactByPhone = new Map(contacts.map((item) => [item.phoneNumber, item]));
  const operations = rows.map((row) => {
    const latest = row.latest as { content?: string; messageType?: string; contactName?: string; createdAt?: Date };
    const contact = contactByPhone.get(row._id as string);
    return {
      updateOne: {
        filter: { phoneNumber: row._id },
        update: {
          $setOnInsert: {
            phoneNumber: row._id as string,
            contactId: contact?._id ?? null,
            businessName: contact?.businessName ?? latest.contactName ?? "",
            contactName: contact?.contactPerson ?? latest.contactName ?? "",
            lastMessage: latest.content || `${latest.messageType ?? "WhatsApp"} message`,
            lastMessageAt: latest.createdAt ?? new Date(),
            lastIncomingMessageAt: (row.lastIncomingMessageAt as Date | null) ?? null,
            unreadCount: Number(row.unreadCount ?? 0),
            leadStatus: "New" as const,
            isLeadActive: true
          }
        },
        upsert: true
      }
    };
  });
  if (operations.length) {
    try {
      await Conversation.bulkWrite(operations, { ordered: false });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
      const count = await Conversation.countDocuments({ phoneNumber: { $in: phones } });
      if (count !== phones.length) throw error;
    }
  }
  try {
    await InboxState.updateOne({ key }, { $set: { completedAt: new Date() } }, { upsert: true });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== 11000) throw error;
  }
}

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const search = (request.nextUrl.searchParams.get("search") ?? "").trim().slice(0, 100);
  const filter = (request.nextUrl.searchParams.get("filter") ?? "all").toLowerCase();
  const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
  if (!["all", "unread", "interested"].includes(filter) || !Number.isInteger(page) || page < 1) {
    return NextResponse.json({ error: { code: "INVALID_FILTER", message: "Conversation filter or page is invalid." } }, { status: 400 });
  }

  try {
    await connectToDatabase();
    await bootstrapStoredMessages();
    const clauses: Record<string, unknown>[] = [];
    if (filter === "unread") clauses.push({ unreadCount: { $gt: 0 } });
    if (filter === "interested") clauses.push({ leadStatus: "Interested" });
    if (search) {
      const regex = new RegExp(escapedRegex(search), "i");
      const matchingContacts = await Contact.find({
        $or: [{ businessName: regex }, { contactPerson: regex }, { phoneNumber: regex }]
      }).select("_id phoneNumber").lean();
      clauses.push({
        $or: [
          { businessName: regex },
          { contactName: regex },
          { phoneNumber: regex },
          ...(matchingContacts.length ? [
            { contactId: { $in: matchingContacts.map((item) => item._id) } },
            { phoneNumber: { $in: matchingContacts.map((item) => item.phoneNumber) } }
          ] : [])
        ]
      });
    }
    const criteria = clauses.length ? { $and: clauses } : {};
    const pageSize = 30;
    const [foundConversations, total] = await Promise.all([
      Conversation.find(criteria)
        .sort({ lastMessageAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      Conversation.countDocuments(criteria)
    ]);
    const pinnedId = request.nextUrl.searchParams.get("conversationId") ?? "";
    let conversations = foundConversations;
    if (!search && filter === "all" && Types.ObjectId.isValid(pinnedId) && !foundConversations.some((item) => String(item._id) === pinnedId)) {
      const pinned = await Conversation.findById(pinnedId).lean();
      if (pinned) conversations = [...foundConversations, pinned];
    }

    const phoneNumbers = conversations.map((item) => item.phoneNumber);
    const contactIds = conversations.map((item) => item.contactId).filter(Boolean);
    const contacts = await Contact.find({
      $or: [
        { _id: { $in: contactIds } },
        { phoneNumber: { $in: phoneNumbers } }
      ]
    }).select("businessName contactPerson phoneNumber categoryId city").lean();
    const contactByPhone = new Map(contacts.map((item) => [item.phoneNumber, item]));
    const missingLinks = conversations.flatMap((item) => {
      const contact = contactByPhone.get(item.phoneNumber);
      return !item.contactId && contact ? [{
        updateOne: {
          filter: { _id: item._id, contactId: null },
          update: {
            $set: {
              contactId: contact._id,
              businessName: contact.businessName,
              contactName: contact.contactPerson
            }
          }
        }
      }] : [];
    });
    if (missingLinks.length) await Conversation.bulkWrite(missingLinks);

    const categories = await Category.find({
      _id: { $in: contacts.map((item) => item.categoryId) }
    }).select("name").lean();
    const categoryNames = new Map(categories.map((item) => [String(item._id), item.name]));
    const items = conversations.map((item) => {
      const contact = contactByPhone.get(item.phoneNumber);
      return {
        _id: String(item._id),
        contactId: contact?._id ? String(contact._id) : "",
        phoneNumber: item.phoneNumber,
        businessName: contact?.businessName || item.businessName,
        contactName: contact?.contactPerson || item.contactName,
        categoryName: contact ? categoryNames.get(String(contact.categoryId)) ?? "" : "",
        city: contact?.city ?? "",
        lastMessage: item.lastMessage,
        lastMessageAt: asIso(item.lastMessageAt),
        lastIncomingMessageAt: asIso(item.lastIncomingMessageAt),
        unreadCount: item.unreadCount,
        leadStatus: item.leadStatus,
        leadStatusUpdatedAt: asIso(item.leadStatusUpdatedAt),
        notes: item.notes
      };
    });

    let summary = null;
    if (request.nextUrl.searchParams.get("summary") === "1") {
      const [totalIncomingReplies, interestedLeads, unreadRows, recentRows] = await Promise.all([
        WhatsAppMessage.countDocuments({ direction: "incoming" }),
        Conversation.countDocuments({ leadStatus: "Interested", isLeadActive: { $ne: false } }),
        WhatsAppMessage.aggregate([
          { $match: { direction: "incoming", isReadInternally: { $ne: true }, phoneNumber: { $ne: "" } } },
          { $group: { _id: "$phoneNumber", count: { $sum: 1 } } }
        ]),
        WhatsAppMessage.aggregate([
          { $match: { direction: "incoming", phoneNumber: { $ne: "" } } },
          { $sort: { messageTimestamp: -1, createdAt: -1 } },
          { $group: { _id: "$phoneNumber", message: { $first: "$$ROOT" } } },
          { $sort: { "message.messageTimestamp": -1, "message.createdAt": -1 } },
          { $limit: 5 }
        ])
      ]);
      const recentPhones = recentRows.map((row) => row._id as string);
      const [recentConversations, recentContacts] = await Promise.all([
        Conversation.find({ phoneNumber: { $in: recentPhones } }).lean(),
        Contact.find({ phoneNumber: { $in: recentPhones } }).select("businessName contactPerson phoneNumber").lean()
      ]);
      const conversationByPhone = new Map(recentConversations.map((item) => [item.phoneNumber, item]));
      const recentContactByPhone = new Map(recentContacts.map((item) => [item.phoneNumber, item]));
      summary = {
        totalIncomingReplies,
        unreadConversations: unreadRows.length,
        unreadMessages: unreadRows.reduce((totalUnread, row) => totalUnread + Number(row.count || 0), 0),
        interestedLeads,
        recentReplies: recentRows.map((row) => {
          const message = row.message as { content?: string; messageTimestamp?: Date; createdAt?: Date; contactName?: string };
          const conversation = conversationByPhone.get(row._id as string);
          const contact = recentContactByPhone.get(row._id as string);
          return {
            phoneNumber: row._id,
            conversationId: conversation ? String(conversation._id) : "",
            name: contact?.businessName || conversation?.businessName || contact?.contactPerson || conversation?.contactName || message.contactName || row._id,
            text: message.content || "Incoming WhatsApp message",
            lastMessageAt: asIso(message.messageTimestamp ?? message.createdAt)
          };
        })
      };
    }
    return NextResponse.json({ conversations: items, page, pageSize, total, totalPages: Math.ceil(total / pageSize), summary });
  } catch (error) {
    console.error("Inbox conversations could not be loaded.", error);
    return NextResponse.json({ error: { code: "INBOX_LOAD_FAILED", message: "Inbox conversations could not be loaded." } }, { status: 500 });
  }
}
