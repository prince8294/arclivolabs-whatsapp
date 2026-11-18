import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/api/rate-limit";
import { contactServerError } from "@/lib/api/contact-errors";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { connectToDatabase } from "@/lib/db/mongodb";
import {
  inspectImportRows,
  summarizeImportRows,
  writeImportRows
} from "@/lib/contacts/import-processing";

const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5000;

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  const limited = rateLimit(request, "contact-import", 10);
  if (limited) return limited;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: { code: "IMPORT_TOO_LARGE", message: "Import request must be 4 MB or smaller." } },
      { status: 413 }
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_BODY", message: "Could not read import request." } }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: { code: "IMPORT_TOO_LARGE", message: "Import request must be 4 MB or smaller." } },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: { code: "INVALID_IMPORT", message: "Import request must be an object." } }, { status: 400 });
  }

  const values = body as Record<string, unknown>;
  const mode = values.mode;
  const rows = values.rows;
  const updateExisting = values.updateExisting === true;
  if (values.updateExisting !== undefined && typeof values.updateExisting !== "boolean") {
    return NextResponse.json(
      { error: { code: "INVALID_IMPORT", message: "Update-existing choice must be a boolean." } },
      { status: 400 }
    );
  }
  if (
    (mode !== "preview" && mode !== "commit") ||
    !Array.isArray(rows) ||
    rows.length < 1 ||
    rows.length > MAX_IMPORT_ROWS
  ) {
    return NextResponse.json(
      { error: { code: "INVALID_IMPORT", message: `Choose preview or commit and provide between 1 and ${MAX_IMPORT_ROWS} rows.` } },
      { status: 400 }
    );
  }

  try {
    await connectToDatabase();
    const inspected = await inspectImportRows(rows, updateExisting);
    if (mode === "preview") {
      return NextResponse.json({
        summary: summarizeImportRows(inspected),
        rows: inspected.map(({ row, businessName, phoneNumber, status, errors }) => ({
          row,
          businessName,
          phoneNumber,
          status,
          errors
        }))
      });
    }

    const outcomes = await writeImportRows(inspected, updateExisting);
    const duplicatesSkipped =
      outcomes.skipped.length + inspected.filter((row) => row.status === "duplicate").length;
    const failedRecords =
      outcomes.failed.length + inspected.filter((row) => row.status === "invalid").length;
    return NextResponse.json({
      result: {
        successfullyImported: outcomes.successful.length,
        duplicatesSkipped,
        failedRecords,
        updatedContacts: outcomes.updated.length,
        excludedRows: inspected.filter((row) => row.status === "excluded").length,
        rows: [
          ...inspected
            .filter((row) => row.status === "invalid" || row.status === "duplicate" || row.status === "excluded")
            .map(({ row, businessName, phoneNumber, status, errors }) => ({ row, businessName, phoneNumber, status, errors })),
          ...outcomes.failed.map(({ row, businessName, phoneNumber, errors }) => ({
            row,
            businessName,
            phoneNumber,
            status: "failed" as const,
            errors
          })),
          ...outcomes.skipped.map(({ row, businessName, phoneNumber, errors }) => ({
            row,
            businessName,
            phoneNumber,
            status: "duplicate" as const,
            errors
          }))
        ]
      }
    });
  } catch (error) {
    return contactServerError(error);
  }
}
