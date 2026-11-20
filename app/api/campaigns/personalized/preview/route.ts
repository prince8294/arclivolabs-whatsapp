import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import { inspectPersonalizedRows, parsePersonalizedRows } from "@/lib/campaigns/personalized";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  if (!isAdminSessionValid(request)) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: { code: "INVALID_IMPORT", message: "Import request must be an object." } }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (input.mode !== "approved_template") {
    return NextResponse.json({ error: { code: "APPROVED_TEMPLATE_REQUIRED", message: "Bulk marketing requires an approved Meta template." } }, { status: 400 });
  }
  if (typeof input.categoryId !== "string") return NextResponse.json({ error: { code: "CATEGORY_REQUIRED", message: "Select one campaign category." } }, { status: 400 });
  const parsed = parsePersonalizedRows(input.rows);
  if (!parsed.ok) return NextResponse.json({ error: { code: "INVALID_IMPORT", message: parsed.message } }, { status: 400 });
  try {
    await connectToDatabase();
    const result = await inspectPersonalizedRows(
      parsed.rows,
      "approved_template",
      typeof input.templateId === "string" ? input.templateId : "",
      input.categoryId
    );
    return NextResponse.json({
      summary: result.summary,
      template: result.template ? { ...result.template, _id: String(result.template._id) } : null,
      rows: result.rows.map((row) => ({
        ...row,
        contactId: row.contactId ? String(row.contactId) : "",
        categoryId: row.categoryId ? String(row.categoryId) : ""
      }))
    });
  } catch (error) {
    console.error("Personalized CSV preview failed.", error);
    return NextResponse.json({ error: { code: "IMPORT_PREVIEW_FAILED", message: "Personalized CSV eligibility could not be calculated." } }, { status: 500 });
  }
}
