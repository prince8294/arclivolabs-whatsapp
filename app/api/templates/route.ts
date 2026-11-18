import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Category from "@/lib/models/category";
import MessageTemplate from "@/lib/models/message-template";
import { validateTemplateInput } from "@/lib/templates/validation";

function templateResponse(template: Record<string, unknown>, categoryName = "") {
  return {
    ...template,
    _id: String(template._id),
    businessCategoryId: template.businessCategoryId ? String(template.businessCategoryId) : "",
    businessCategory: categoryName,
    variableSamples: template.variableSamples instanceof Map
      ? Object.fromEntries(template.variableSamples)
      : template.variableSamples ?? {}
  };
}

function serverError(error: unknown) {
  console.error("Template API request failed.", error);
  const message = error instanceof Error && error.message.includes("MONGODB_URI is not configured")
    ? "Database connection is not configured."
    : "The template request could not be completed.";
  return NextResponse.json({ error: { code: "TEMPLATE_REQUEST_FAILED", message } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const templates = await MessageTemplate.find().sort({ updatedAt: -1 }).lean();
    const categories = await Category.find({ _id: { $in: templates.map((item) => item.businessCategoryId).filter(Boolean) } })
      .select("name")
      .lean();
    const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));
    const items = templates.map((template) => templateResponse(
      template as unknown as Record<string, unknown>,
      template.businessCategoryId ? categoryNames.get(String(template.businessCategoryId)) ?? "" : ""
    ));
    return NextResponse.json({ templates: items });
  } catch (error) {
    return serverError(error);
  }
}

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
  const parsed = validateTemplateInput(body);
  if (!parsed.ok) return NextResponse.json({ error: { code: "INVALID_TEMPLATE", message: parsed.message } }, { status: 400 });
  const input = parsed.value;
  if (input.businessCategoryId && !mongoose.isValidObjectId(input.businessCategoryId)) {
    return NextResponse.json({ error: { code: "INVALID_CATEGORY", message: "Select a valid business category." } }, { status: 400 });
  }
  try {
    await connectToDatabase();
    if (input.businessCategoryId && !(await Category.exists({ _id: input.businessCategoryId }))) {
      return NextResponse.json({ error: { code: "CATEGORY_NOT_FOUND", message: "The selected business category no longer exists." } }, { status: 400 });
    }
    const template = await MessageTemplate.create({
      ...input,
      businessCategoryId: input.businessCategoryId || null,
      metaStatus: "",
      isDraft: true
    });
    const category = input.businessCategoryId ? await Category.findById(input.businessCategoryId).select("name").lean() : null;
    return NextResponse.json({
      template: templateResponse(template.toObject() as unknown as Record<string, unknown>, category?.name ?? "")
    }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return NextResponse.json({ error: { code: "TEMPLATE_EXISTS", message: "A template with this name and language already exists." } }, { status: 409 });
    }
    return serverError(error);
  }
}
