import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import { parseCampaignInput } from "@/lib/campaigns/input";
import { refreshCampaignCounts } from "@/lib/campaigns/counts";
import Campaign from "@/lib/models/campaign";
import Category from "@/lib/models/category";
import MessageTemplate from "@/lib/models/message-template";

type RouteContext = { params: { id: string } };

export async function GET(request: NextRequest, { params }: RouteContext) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
  }
  try {
    await connectToDatabase();
    const refreshed = await refreshCampaignCounts(params.id);
    if (!refreshed) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
    const [categories, template] = await Promise.all([
      Category.find({ _id: { $in: refreshed.categoryIds } }).select("name").lean(),
      refreshed.templateId ? MessageTemplate.findById(refreshed.templateId).select("name,language,metaStatus,body").lean() : null
    ]);
    return NextResponse.json({
      campaign: {
        ...refreshed,
        _id: String(refreshed._id),
        categoryNames: categories.map((item) => item.name),
        template: template ? {
          _id: String(refreshed.templateId),
          name: template.name,
          language: template.language,
          metaStatus: template.metaStatus,
          body: template.body
        } : null
      }
    });
  } catch (error) {
    console.error("Campaign details could not be loaded.", error);
    return NextResponse.json({ error: { code: "CAMPAIGN_DETAILS_FAILED", message: "Campaign details could not be loaded." } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  const parsed = parseCampaignInput(body, true);
  if (!parsed.ok) return NextResponse.json({ error: { code: "INVALID_CAMPAIGN", message: parsed.message } }, { status: 400 });
  try {
    await connectToDatabase();
    const current = await Campaign.findById(params.id);
    if (!current) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Campaign was not found." } }, { status: 404 });
    if (current.status !== "Draft") return NextResponse.json({ error: { code: "CAMPAIGN_NOT_EDITABLE", message: "Only a draft campaign can be edited." } }, { status: 409 });
    if (parsed.value.categoryIds.length !== await Category.countDocuments({ _id: { $in: parsed.value.categoryIds } })) {
      return NextResponse.json({ error: { code: "CATEGORY_NOT_FOUND", message: "One or more selected categories no longer exist." } }, { status: 400 });
    }
    if (parsed.value.templateId && !(await MessageTemplate.exists({ _id: parsed.value.templateId }))) {
      return NextResponse.json({ error: { code: "TEMPLATE_NOT_FOUND", message: "Selected template was not found." } }, { status: 400 });
    }
    current.name = parsed.value.name;
    current.description = parsed.value.description;
    current.set("categoryIds", parsed.value.categoryIds.map((id) => new Types.ObjectId(id)));
    current.cities = parsed.value.cities;
    current.templateId = parsed.value.templateId ? new Types.ObjectId(parsed.value.templateId) : null;
    current.set("variableMappings", parsed.value.variableMappings);
    await current.save();
    return NextResponse.json({ campaign: { _id: current._id.toString(), name: current.name, status: current.status } });
  } catch (error) {
    console.error("Campaign draft could not be updated.", error);
    return NextResponse.json({ error: { code: "CAMPAIGN_UPDATE_FAILED", message: "Campaign draft could not be updated." } }, { status: 500 });
  }
}
