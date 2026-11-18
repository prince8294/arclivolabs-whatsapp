import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import MessageTemplate from "@/lib/models/message-template";
import { campaignFilterIds, summarizeAudience } from "@/lib/campaigns/audience";
import { parseCampaignInput } from "@/lib/campaigns/input";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  const parsed = parseCampaignInput({
    name: "Audience preview",
    categoryIds: (body as Record<string, unknown>)?.categoryIds,
    cities: (body as Record<string, unknown>)?.cities,
    templateId: (body as Record<string, unknown>)?.templateId ?? "",
    variableMappings: (body as Record<string, unknown>)?.variableMappings ?? []
  });
  if (!parsed.ok) return NextResponse.json({ error: { code: "INVALID_AUDIENCE", message: parsed.message } }, { status: 400 });
  const categoryIds = campaignFilterIds(parsed.value.categoryIds);
  if (!categoryIds) return NextResponse.json({ error: { code: "INVALID_AUDIENCE", message: "Select at least one business category." } }, { status: 400 });
  try {
    await connectToDatabase();
    let templateBody = "";
    if (parsed.value.templateId) {
      const template = await MessageTemplate.findOne({
        _id: new Types.ObjectId(parsed.value.templateId),
        isDraft: false,
        metaStatus: "APPROVED"
      }).select("body").lean();
      if (!template) return NextResponse.json({ error: { code: "TEMPLATE_NOT_APPROVED", message: "Choose a template currently approved by Meta." } }, { status: 400 });
      templateBody = template.body;
    }
    const result = await summarizeAudience({
      categoryIds,
      cities: parsed.value.cities,
      variableMappings: parsed.value.variableMappings,
      body: templateBody
    });
    const categories = await import("@/lib/models/category").then(({ default: Category }) =>
      Category.find({ _id: { $in: categoryIds } }).select("name").lean()
    );
    return NextResponse.json({
      ...result,
      categories: categories.map((item) => ({ _id: String(item._id), name: item.name }))
    });
  } catch (error) {
    console.error("Campaign audience preview failed.", error);
    return NextResponse.json({ error: { code: "AUDIENCE_PREVIEW_FAILED", message: "Audience could not be calculated." } }, { status: 500 });
  }
}
