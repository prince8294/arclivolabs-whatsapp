import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import MessageTemplate from "@/lib/models/message-template";
import Category from "@/lib/models/category";
import { extractTemplateVariables } from "@/lib/templates/validation";
import { getStoredConnection, getEffectiveCredentials, markConnectionError } from "@/lib/whatsapp/config";
import { MetaApiError } from "@/lib/whatsapp/meta";
import { listMetaTemplates, supportedTemplateComponents } from "@/lib/campaigns/meta-templates";

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  try {
    const connection = await getStoredConnection();
    if (!connection || connection.status !== "connected") {
      return NextResponse.json({ error: { code: "NOT_CONNECTED", message: "Connect WhatsApp to load templates eligible for sending." } }, { status: 409 });
    }
    const { credentials } = await getEffectiveCredentials();
    const records = await listMetaTemplates(credentials, credentials.wabaId);
    await connectToDatabase();
    const localTemplates = await MessageTemplate.find({ isDraft: false, metaTemplateId: { $ne: "" } }).lean();
    const categories = await Category.find({
      _id: { $in: localTemplates.map((template) => template.businessCategoryId).filter(Boolean) }
    }).select("name").lean();
    const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));
    const choices = [];
    for (const remote of records) {
      if (typeof remote.id !== "string" || typeof remote.name !== "string" || typeof remote.language !== "string") continue;
      const remoteName = remote.name;
      const remoteLanguage = remote.language;
      const local = localTemplates.find((template) =>
        template.metaTemplateId === remote.id ||
        (template.name === remoteName && template.language.toLowerCase() === remoteLanguage.toLowerCase())
      );
      if (!local) continue;
      const status = typeof remote.status === "string" ? remote.status.toUpperCase() : "";
      const category = typeof remote.category === "string" ? remote.category.toUpperCase() : "";
      const components = supportedTemplateComponents(remote.components);
      if (status !== "APPROVED" || category !== "MARKETING" || !components) {
        await MessageTemplate.updateOne(
          { _id: local._id },
          { $set: { metaStatus: status, metaCategory: category || local.metaCategory, lastSyncedAt: new Date() } }
        );
        continue;
      }
      if ([
        components.header,
        components.footer,
        ...components.buttons.map((button) => button.url ?? "")
      ].some((value) => /\{\{\s*\d+\s*\}\}/.test(value))) continue;
      const variables = extractTemplateVariables(components.body);
      if (variables.some((number, index) => number !== index + 1)) continue;
      choices.push({
        _id: local._id.toString(),
        name: remoteName,
        businessCategoryId: local.businessCategoryId?.toString() ?? "",
        businessCategory: local.businessCategoryId ? categoryNames.get(String(local.businessCategoryId)) ?? "" : "",
        language: remoteLanguage,
        metaCategory: category,
        metaStatus: status,
        body: components.body,
        header: components.header,
        footer: components.footer,
        buttons: components.buttons,
        variables,
        variableSamples: local.variableSamples instanceof Map ? Object.fromEntries(local.variableSamples) : local.variableSamples ?? {},
        variableMappings: local.variableMappings.map((item) => ({ number: item.number, mapping: item.mapping }))
      });
      await MessageTemplate.updateOne(
        { _id: local._id },
        { $set: { metaStatus: status, metaCategory: category, lastSyncedAt: new Date() } }
      );
    }
    return NextResponse.json({ templates: choices });
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)) {
        await markConnectionError(error.message);
      }
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    console.error("Approved campaign templates could not be loaded.", error);
    return NextResponse.json({ error: { code: "CAMPAIGN_TEMPLATES_FAILED", message: "Approved templates could not be loaded." } }, { status: 500 });
  }
}
