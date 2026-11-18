import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import CampaignRecipient from "@/lib/models/campaign-recipient";

type RouteContext = { params: { id: string } };
const allowedStatuses = ["all", "pending", "sent", "delivered", "read", "failed", "excluded"] as const;

export async function GET(request: NextRequest, { params }: RouteContext) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
  }
  const search = request.nextUrl.searchParams;
  const page = Number(search.get("page") ?? 1);
  const filter = (search.get("status") ?? "all").toLowerCase();
  if (!Number.isInteger(page) || page < 1 || !allowedStatuses.includes(filter as (typeof allowedStatuses)[number])) {
    return NextResponse.json({ error: { code: "INVALID_FILTER", message: "Recipient filter or page is invalid." } }, { status: 400 });
  }
  const criteria: Record<string, unknown> = { campaignId: new Types.ObjectId(params.id) };
  if (filter === "pending") criteria.$or = [
    { queueStatus: { $in: ["queued", "processing", "paused"] } },
    {
      queueStatus: { $nin: ["excluded", "cancelled"] },
      deliveryStatus: { $in: ["pending", "accepted", "uncertain"] }
    }
  ];
  if (filter === "sent") criteria.deliveryStatus = "sent";
  if (filter === "delivered") criteria.deliveryStatus = "delivered";
  if (filter === "read") criteria.deliveryStatus = "read";
  if (filter === "failed") criteria.$or = [{ queueStatus: "failed" }, { deliveryStatus: "failed" }];
  if (filter === "excluded") criteria.queueStatus = "excluded";
  try {
    await connectToDatabase();
    const pageSize = 50;
    const [recipients, total] = await Promise.all([
      CampaignRecipient.find(criteria)
        .sort({ createdAt: 1, _id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      CampaignRecipient.countDocuments(criteria)
    ]);
    return NextResponse.json({
      recipients: recipients.map((recipient) => ({
        ...recipient,
        _id: String(recipient._id),
        campaignId: String(recipient.campaignId),
        contactId: recipient.contactId ? String(recipient.contactId) : "",
        categoryId: recipient.categoryId ? String(recipient.categoryId) : ""
      })),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    });
  } catch (error) {
    console.error("Campaign recipients could not be loaded.", error);
    return NextResponse.json({ error: { code: "RECIPIENTS_LOAD_FAILED", message: "Recipient results could not be loaded." } }, { status: 500 });
  }
}
