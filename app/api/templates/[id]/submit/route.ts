import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import MessageTemplate from "@/lib/models/message-template";
import { getEffectiveCredentials, getStoredConnection, markConnectionError } from "@/lib/whatsapp/config";
import { graphRequest, MetaApiError } from "@/lib/whatsapp/meta";
import { validateTemplateInput, validateTemplateSamples } from "@/lib/templates/validation";

type RouteContext = { params: { id: string } };

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  try {
    await connectToDatabase();
    const template = await MessageTemplate.findById(params.id);
    if (!template) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
    if (!template.isDraft || template.metaTemplateId) {
      return NextResponse.json({ error: { code: "ALREADY_SUBMITTED", message: "This template has already been submitted to Meta." } }, { status: 409 });
    }
    const current = {
      name: template.name,
      businessCategoryId: template.businessCategoryId?.toString() ?? "",
      metaCategory: template.metaCategory,
      language: template.language,
      header: template.header,
      body: template.body,
      footer: template.footer,
      buttons: template.buttons,
      variableSamples: Object.fromEntries(template.variableSamples ?? new Map()),
      variableMappings: template.variableMappings
    };
    const parsed = validateTemplateInput(current);
    if (!parsed.ok) return NextResponse.json({ error: { code: "INVALID_TEMPLATE", message: parsed.message } }, { status: 400 });
    if (!validateTemplateSamples(parsed.value)) {
      return NextResponse.json({ error: { code: "MISSING_VARIABLE_SAMPLES", message: "Add a sample value for every numbered variable before submitting." } }, { status: 400 });
    }
    const connection = await getStoredConnection();
    if (!connection || connection.status !== "connected") {
      return NextResponse.json({ error: { code: "NOT_CONNECTED", message: "Connect WhatsApp and verify the Meta API connection before submitting." } }, { status: 409 });
    }
    const { credentials } = await getEffectiveCredentials();
    const account = await graphRequest<{ id?: unknown }>(
      credentials,
      `${encodeURIComponent(credentials.wabaId)}?fields=id`
    );
    if (account.id !== credentials.wabaId) {
      return NextResponse.json({ error: { code: "WABA_MISMATCH", message: "Meta could not verify the connected WhatsApp Business Account." } }, { status: 409 });
    }
    const components: Record<string, unknown>[] = [];
    if (parsed.value.header) components.push({ type: "HEADER", format: "TEXT", text: parsed.value.header });
    const bodyComponent: Record<string, unknown> = { type: "BODY", text: parsed.value.body };
    if (parsed.value.variables.length) {
      bodyComponent.example = {
        body_text: [parsed.value.variables.map((number) => parsed.value.variableSamples[String(number)])]
      };
    }
    components.push(bodyComponent);
    if (parsed.value.footer) components.push({ type: "FOOTER", text: parsed.value.footer });
    if (parsed.value.buttons.length) {
      components.push({
        type: "BUTTONS",
        buttons: parsed.value.buttons.map((button) =>
          button.type === "URL"
            ? { type: "URL", text: button.text, url: button.url }
            : { type: "QUICK_REPLY", text: button.text }
        )
      });
    }
    const result = await graphRequest<{
      id?: unknown;
      status?: unknown;
      category?: unknown;
      message?: unknown;
    }>(credentials, `${encodeURIComponent(credentials.wabaId)}/message_templates`, {
      method: "POST",
      retrySafe: false,
      body: {
        name: parsed.value.name,
        language: parsed.value.language,
        category: parsed.value.metaCategory,
        components
      }
    });
    if (typeof result.id !== "string" || !result.id) {
      template.isDraft = false;
      template.lastSyncedAt = new Date();
      await template.save();
      return NextResponse.json({ error: { code: "META_RESULT_INCOMPLETE", message: "Meta accepted the request but did not return a template ID. Refresh template status before retrying." } }, { status: 502 });
    }
    template.metaTemplateId = result.id;
    template.metaStatus = typeof result.status === "string" ? result.status : "";
    if (typeof result.category === "string") {
      template.metaCategory = result.category.toUpperCase() as typeof template.metaCategory;
    }
    template.isDraft = false;
    template.lastSyncedAt = new Date();
    await template.save();
    return NextResponse.json({
      submitted: true,
      templateId: result.id,
      status: template.metaStatus || "Submission accepted; awaiting status from Meta.",
      category: template.metaCategory,
      message: typeof result.message === "string" ? result.message : ""
    });
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)) {
        await markConnectionError(error.message);
      }
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    console.error("Template submission failed.", error);
    return NextResponse.json({ error: { code: "TEMPLATE_SUBMISSION_FAILED", message: "The template could not be submitted. Check the WhatsApp connection and try again." } }, { status: 500 });
  }
}
