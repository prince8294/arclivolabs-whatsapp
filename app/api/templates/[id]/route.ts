import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import Category from "@/lib/models/category";
import MessageTemplate from "@/lib/models/message-template";
import { validateTemplateInput } from "@/lib/templates/validation";
import { getEffectiveCredentials, getStoredConnection, markConnectionError } from "@/lib/whatsapp/config";
import { graphRequest, MetaApiError } from "@/lib/whatsapp/meta";

type RouteContext = { params: { id: string } };

function validId(id: string) {
  return mongoose.isValidObjectId(id);
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!validId(params.id)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
  try {
    await connectToDatabase();
    const template = await MessageTemplate.findById(params.id).lean();
    if (!template) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
    const category = template.businessCategoryId
      ? await Category.findById(template.businessCategoryId).select("name").lean()
      : null;
    return NextResponse.json({
      template: {
        ...template,
        _id: String(template._id),
        businessCategoryId: template.businessCategoryId ? String(template.businessCategoryId) : "",
        businessCategory: category?.name ?? "",
        variableSamples: template.variableSamples instanceof Map
          ? Object.fromEntries(template.variableSamples)
          : template.variableSamples ?? {}
      }
    });
  } catch (error) {
    console.error("Template details could not be loaded.", error);
    return NextResponse.json({ error: { code: "TEMPLATE_REQUEST_FAILED", message: "Template details could not be loaded." } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!validId(params.id)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
  if (!validId(params.id)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
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
    const current = await MessageTemplate.findById(params.id);
    if (!current) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
    if (!current.isDraft || current.metaTemplateId) {
      return NextResponse.json({ error: { code: "META_TEMPLATE_READ_ONLY", message: "Templates already submitted to Meta cannot be edited here. Create a new draft to make changes and submit it for review." } }, { status: 409 });
    }
    if (input.businessCategoryId && !(await Category.exists({ _id: input.businessCategoryId }))) {
      return NextResponse.json({ error: { code: "CATEGORY_NOT_FOUND", message: "The selected business category no longer exists." } }, { status: 400 });
    }
    Object.assign(current, input, { businessCategoryId: input.businessCategoryId || null });
    await current.save();
    const category = input.businessCategoryId ? await Category.findById(input.businessCategoryId).select("name").lean() : null;
    return NextResponse.json({
      template: {
        ...current.toObject(),
        _id: current._id.toString(),
        businessCategoryId: input.businessCategoryId,
        businessCategory: category?.name ?? "",
        variableSamples: Object.fromEntries(current.variableSamples ?? new Map())
      }
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return NextResponse.json({ error: { code: "TEMPLATE_EXISTS", message: "A template with this name and language already exists." } }, { status: 409 });
    }
    console.error("Template could not be updated.", error);
    return NextResponse.json({ error: { code: "TEMPLATE_REQUEST_FAILED", message: "Template could not be updated." } }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!validId(params.id)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
  if (!validId(params.id)) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
  try {
    await connectToDatabase();
    const template = await MessageTemplate.findById(params.id);
    if (!template) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
    const deleteFromMeta = request.nextUrl.searchParams.get("deleteFromMeta") === "true";
    if (deleteFromMeta) {
      if (template.isDraft || !template.metaTemplateId) {
        return NextResponse.json({ error: { code: "NOT_SUBMITTED", message: "Only a template submitted to Meta can be deleted from Meta." } }, { status: 409 });
      }
      const connection = await getStoredConnection();
      if (!connection || connection.status !== "connected") {
        return NextResponse.json({ error: { code: "NOT_CONNECTED", message: "Connect WhatsApp before deleting a template from Meta." } }, { status: 409 });
      }
      const { credentials } = await getEffectiveCredentials();
      const result = await graphRequest<{ success?: unknown }>(
        credentials,
        `${encodeURIComponent(credentials.wabaId)}/message_templates?name=${encodeURIComponent(template.name)}`,
        { method: "DELETE", retrySafe: false }
      );
      if (result.success !== true) {
        return NextResponse.json({ error: { code: "META_DELETE_UNCONFIRMED", message: "Meta did not confirm deletion. The local record was kept." } }, { status: 502 });
      }
    }
    await template.deleteOne();
    return NextResponse.json({ deleted: true, deletedFromMeta: deleteFromMeta });
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)) {
        await markConnectionError(error.message);
      }
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    console.error("Template could not be deleted.", error);
    return NextResponse.json({ error: { code: "TEMPLATE_REQUEST_FAILED", message: "Template could not be deleted." } }, { status: 500 });
  }
}
