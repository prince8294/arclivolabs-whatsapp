import { getEffectiveCredentials, type MetaWhatsAppCredentials } from "@/lib/whatsapp/config";
import { graphRequest } from "@/lib/whatsapp/meta";

export type MetaTemplateRecord = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  language?: unknown;
  category?: unknown;
  components?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function listMetaTemplates(credentials: MetaWhatsAppCredentials, wabaId: string) {
  const records: MetaTemplateRecord[] = [];
  let path = `${encodeURIComponent(wabaId)}/message_templates?fields=id,name,status,language,category,components&limit=100`;
  for (let page = 0; page < 25; page += 1) {
    const result = await graphRequest<{ data?: unknown; paging?: { cursors?: { after?: unknown } } }>(credentials, path);
    if (Array.isArray(result.data)) records.push(...result.data.filter(isRecord) as MetaTemplateRecord[]);
    const cursor = result.paging?.cursors?.after;
    if (typeof cursor !== "string" || !cursor) break;
    path = `${encodeURIComponent(wabaId)}/message_templates?fields=id,name,status,language,category,components&limit=100&after=${encodeURIComponent(cursor)}`;
  }
  return records;
}

export function supportedTemplateComponents(value: unknown) {
  if (!Array.isArray(value)) return null;
  let body = "";
  let header = "";
  let footer = "";
  const buttons: { type: "QUICK_REPLY" | "URL"; text: string; url?: string }[] = [];
  for (const component of value) {
    if (!isRecord(component)) return null;
    if (component.type === "BODY" && typeof component.text === "string") {
      body = component.text;
    } else if (component.type === "HEADER") {
      if (component.format !== "TEXT" || typeof component.text !== "string") return null;
      header = component.text;
    } else if (component.type === "FOOTER" && typeof component.text === "string") {
      footer = component.text;
    } else if (component.type === "BUTTONS" && Array.isArray(component.buttons)) {
      for (const item of component.buttons) {
        if (!isRecord(item) || typeof item.text !== "string") return null;
        if (item.type === "QUICK_REPLY") buttons.push({ type: "QUICK_REPLY", text: item.text });
        else if (item.type === "URL" && typeof item.url === "string") {
          buttons.push({ type: "URL", text: item.text, url: item.url });
        } else return null;
      }
    } else {
      return null;
    }
  }
  return body ? { body, header, footer, buttons } : null;
}

export function extractComponentTemplateVariables(components: {
  body: string;
  header: string;
  buttons: { url?: string }[];
}) {
  const values = [components.header, components.body, ...components.buttons.map((button) => button.url ?? "")];
  return [...new Set(values.flatMap((text) => {
    const found: number[] = [];
    const pattern = /\{\{\s*(\d+)\s*\}\}/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) found.push(Number(match[1]));
    return found;
  }))].sort((a, b) => a - b);
}

export async function requireMetaCredentials() {
  return getEffectiveCredentials();
}
