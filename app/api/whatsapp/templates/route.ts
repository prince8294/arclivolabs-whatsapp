import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/auth/admin-session";
import { getStoredConnection, getEffectiveCredentials, markConnectionError } from "@/lib/whatsapp/config";
import { whatsappApiError } from "@/lib/whatsapp/errors";
import { graphRequest, MetaApiError } from "@/lib/whatsapp/meta";
import { isUsableTestTemplateComponents } from "@/lib/whatsapp/templates";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }

  try {
    const connection = await getStoredConnection();
    if (!connection || connection.status !== "connected") {
      return NextResponse.json(
        { error: { code: "NOT_CONNECTED", message: "Connect WhatsApp before loading approved templates." } },
        { status: 409 }
      );
    }
    const { credentials } = await getEffectiveCredentials();
    let path = `${encodeURIComponent(credentials.wabaId)}/message_templates?fields=name,status,language,components&limit=100`;
    const records: unknown[] = [];
    for (let page = 0; page < 5; page += 1) {
      const result = await graphRequest<{
        data?: unknown;
        paging?: { cursors?: { after?: unknown } };
      }>(credentials, path);
      const pageRecords = Array.isArray(result.data) ? result.data : [];
      records.push(...pageRecords);
      const cursor = result.paging?.cursors?.after;
      if (typeof cursor !== "string" || !cursor) break;
      path = `${encodeURIComponent(credentials.wabaId)}/message_templates?fields=name,status,language,components&limit=100&after=${encodeURIComponent(cursor)}`;
    }

    const templates = records
      .filter((template) => {
        if (!isRecord(template) || template.status !== "APPROVED") return false;
        return isUsableTestTemplateComponents(template.components);
      })
      .filter((template) => isRecord(template) && typeof template.name === "string" && typeof template.language === "string")
      .map((template) => {
        if (!isRecord(template)) return null;
        const { name, language } = template;
        return typeof name === "string" && typeof language === "string" ? { name, language } : null;
      })
      .filter((template): template is { name: string; language: string } => template !== null);
    return NextResponse.json({ templates });
  } catch (error) {
    if (
      error instanceof MetaApiError &&
      ["META_TOKEN_INVALID", "META_PERMISSION_DENIED", "META_RESOURCE_NOT_FOUND"].includes(error.code)
    ) {
      await markConnectionError(error.message);
    }
    return whatsappApiError(error);
  }
}
