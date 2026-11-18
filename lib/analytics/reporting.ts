import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";

export type AnalyticsFilters = {
  start: Date;
  end: Date;
  categoryId: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value: string) {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseAnalyticsFilters(request: NextRequest):
  | { ok: true; filters: AnalyticsFilters }
  | { ok: false; response: NextResponse } {
  const params = request.nextUrl.searchParams;
  const range = params.get("range") ?? "30d";
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let start: Date;
  let end: Date;

  if (range === "today") {
    start = today;
    end = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  } else if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    end = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  } else if (range === "custom") {
    const startValue = params.get("start");
    const endValue = params.get("end");
    if (!startValue || !endValue || !isValidDateOnly(startValue) || !isValidDateOnly(endValue) || startValue > endValue) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: { code: "INVALID_DATE_RANGE", message: "Choose a valid custom date range." } },
          { status: 400 }
        )
      };
    }
    start = new Date(`${startValue}T00:00:00.000Z`);
    end = new Date(`${endValue}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
  } else {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "INVALID_DATE_RANGE", message: "Choose Today, Last 7 Days, Last 30 Days, or a custom range." } },
        { status: 400 }
      )
    };
  }

  const categoryId = params.get("categoryId") ?? "";
  if (categoryId && !Types.ObjectId.isValid(categoryId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "INVALID_CATEGORY", message: "Choose a valid business category." } },
        { status: 400 }
      )
    };
  }
  return { ok: true, filters: { start, end, categoryId } };
}

export function campaignDateCriteria(filters: AnalyticsFilters) {
  return {
    createdAt: { $gte: filters.start, $lt: filters.end },
    ...(filters.categoryId ? { categoryIds: new Types.ObjectId(filters.categoryId) } : {})
  };
}

export function recipientCategoryCriteria(filters: AnalyticsFilters) {
  return filters.categoryId ? { categoryId: new Types.ObjectId(filters.categoryId) } : {};
}

export function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

export function safeCsvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const protectedText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
}

export function csvResponse(rows: unknown[][], filename: string) {
  const csv = `\uFEFF${rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
