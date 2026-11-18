import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Campaign from "@/lib/models/campaign";
import { enqueueResumeWork } from "@/lib/campaigns/worker";

type RouteContext = { params: { id: string } };

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  if (!isAdminSessionValid(request)) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  if (!Types.ObjectId.isValid(params.id)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
  if (!process.env.REDIS_URL?.trim()) return NextResponse.json({ error: { code: "REDIS_NOT_CONFIGURED", message: "Configure Redis before resuming the campaign." } }, { status: 503 });
  try {
    await connectToDatabase();
    const campaign = await Campaign.findOneAndUpdate(
      { _id: params.id, status: "Paused" },
      { $set: { status: "Processing" } },
      { new: true }
    ).lean();
    if (!campaign) return NextResponse.json({ error: { code: "INVALID_CAMPAIGN_STATE", message: "Only a paused campaign can be resumed." } }, { status: 409 });
    await enqueueResumeWork(params.id);
    return NextResponse.json({ status: "Processing" });
  } catch (error) {
    console.error("Campaign resume could not be queued.", error);
    return NextResponse.json({ error: { code: "CAMPAIGN_RESUME_FAILED", message: "Campaign could not be resumed. Worker recovery will reconcile queued recipients." } }, { status: 503 });
  }
}
