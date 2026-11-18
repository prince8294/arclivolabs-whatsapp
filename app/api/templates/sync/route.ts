import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import MessageTemplate from "@/lib/models/message-template";
import { getEffectiveCredentials, getStoredConnection, markConnectionError } from "@/lib/whatsapp/config";
import { graphRequest, MetaApiError } from "@/lib/whatsapp/meta";

type MetaTemplate = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  language?: unknown;
  category?: unknown;
  components?: unknown;
  rejected_reason?: unknown;
  rejection_reason?: unknown;
};

function asRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseComponents(value: unknown) {
  const result = { header: "", body: "", footer: "", buttons: [] as { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[] };
  if (!Array.isArray(value)) return result;
  for (const component of value) {
    if (!asRecord(component)) continue;
    if (component.type === "HEADER" && typeof component.text === "string") result.header = component.text;
    if (component.type === "BODY" && typeof component.text === "string") result.body = component.text;
    if (component.type === "FOOTER" && typeof component.text === "string") result.footer = component.text;
    if (component.type === "BUTTONS" && Array.isArray(component.buttons)) {
      for (const button of component.buttons) {
        if (!asRecord(button) || typeof button.text !== "string") continue;
        if (button.type === "QUICK_REPLY") result.buttons.push({ type: "QUICK_REPLY", text: button.text });
        if (button.type === "URL" && typeof button.url === "string") {
          result.buttons.push({ type: "URL", text: button.text, url: button.url });
        }
      }
    }
  }
  return result;
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  try {
    const connection = await getStoredConnection();
    if (!connection || connection.status !== "connected") {
      return NextResponse.json({ error: { code: "NOT_CONNECTED", message: "Connect WhatsApp before synchronizing templates." } }, { status: 409 });
    }
    const { credentials } = await getEffectiveCredentials();
    const records: MetaTemplate[] = [];
    let path = `${encodeURIComponent(credentials.wabaId)}/message_templates?fields=id,name,status,language,category,components&limit=100`;
    for (let page = 0; page < 25; page += 1) {
      const result = await graphRequest<{ data?: unknown; paging?: { cursors?: { after?: unknown } } }>(credentials, path);
      if (Array.isArray(result.data)) records.push(...result.data.filter(asRecord) as MetaTemplate[]);
      const cursor = result.paging?.cursors?.after;
      if (typeof cursor !== "string" || !cursor) break;
      path = `${encodeURIComponent(credentials.wabaId)}/message_templates?fields=id,name,status,language,category,components&limit=100&after=${encodeURIComponent(cursor)}`;
    }
    await connectToDatabase();
    let imported = 0;
    let updated = 0;
    for (const record of records) {
      if (typeof record.id !== "string" || typeof record.name !== "string" || typeof record.language !== "string") continue;
      const category = typeof record.category === "string" ? record.category.toUpperCase() : "";
      if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) continue;
      const components = parseComponents(record.components);
      if (!components.body) continue;
      const body = components.body;
      const variables = [...new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
      const prior = await MessageTemplate.findOne({
        $or: [{ metaTemplateId: record.id }, { name: record.name.toLowerCase(), language: record.language.toLowerCase() }]
      });
      if (prior) updated += 1;
      else imported += 1;
      await MessageTemplate.findOneAndUpdate(
        prior
          ? { _id: prior._id }
          : { name: record.name.toLowerCase(), language: record.language },
        {
          $set: {
            name: record.name.toLowerCase(),
            language: record.language,
            metaCategory: category,
            metaStatus: typeof record.status === "string" ? record.status : "",
            metaTemplateId: record.id,
            isDraft: false,
            header: components.header,
            body,
            footer: components.footer,
            buttons: components.buttons,
            variables,
            rejectionReason: typeof record.rejected_reason === "string"
              ? record.rejected_reason
              : typeof record.rejection_reason === "string" ? record.rejection_reason : "",
            lastSyncedAt: new Date()
          },
          $setOnInsert: { businessCategoryId: null, variableSamples: {}, variableMappings: [] }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    return NextResponse.json({ imported, updated, total: records.length });
  } catch (error) {
    if (error instanceof MetaApiError) {
      if (["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)) {
        await markConnectionError(error.message);
      }
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    console.error("Template synchronization failed.", error);
    return NextResponse.json({ error: { code: "TEMPLATE_SYNC_FAILED", message: "Templates could not be synchronized." } }, { status: 500 });
  }
}
