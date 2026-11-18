import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Campaign from "@/lib/models/campaign";
import CampaignRecipient from "@/lib/models/campaign-recipient";
import { refreshCampaignCounts } from "@/lib/campaigns/counts";

type RouteContext = { params: { id: string } };

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  if (!isAdminSessionValid(request)) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  if (!Types.ObjectId.isValid(params.id)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
  try {
    await connectToDatabase();
    const campaign = await Campaign.findOneAndUpdate(
      { _id: params.id, status: { $in: ["Queued", "Processing"] } },
      { $set: { status: "Paused" } },
      { new: true }
    ).lean();
    if (!campaign) return NextResponse.json({ error: { code: "INVALID_CAMPAIGN_STATE", message: "Only an active campaign can be paused." } }, { status: 409 });
    await CampaignRecipient.updateMany(
      { campaignId: campaign._id, queueStatus: "queued" },
      { $set: { queueStatus: "paused", updatedStatusAt: new Date() }, $inc: { queueVersion: 1 } }
    );
    await refreshCampaignCounts(params.id);
    return NextResponse.json({ status: campaign.status });
  } catch (error) {
    console.error("Campaign could not be paused.", error);
    return NextResponse.json({ error: { code: "CAMPAIGN_UPDATE_FAILED", message: "Campaign could not be paused." } }, { status: 500 });
  }
}
