import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { categoryServerError, duplicateCategoryResponse } from "@/lib/api/category-errors";
import { getCategoryContactCounts } from "@/lib/data/category-counts";
import { connectToDatabase } from "@/lib/db/mongodb";
import Category from "@/lib/models/category";
import { validateCategoryInput } from "@/lib/categories/validation";

export async function GET(request: NextRequest) {
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }

  try {
    await connectToDatabase();
    const categories = await Category.find().sort({ name: 1 }).lean();
    const counts = await getCategoryContactCounts(categories.map((category) => category._id));
    const items = categories.map((category) => ({
      ...category,
      _id: category._id.toString(),
      contactCount: counts.get(category._id.toString()) ?? 0
    }));

    return NextResponse.json({ categories: items, total: items.length });
  } catch (error) {
    return categoryServerError(error);
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

  const parsed = validateCategoryInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: { code: "INVALID_CATEGORY", message: parsed.message } }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const duplicate = await Category.exists({ normalizedName: parsed.value.normalizedName });
    if (duplicate) return duplicateCategoryResponse();

    const category = await Category.create(parsed.value);
    return NextResponse.json(
      {
        category: {
          _id: category._id.toString(),
          name: category.name,
          slug: category.slug,
          description: category.description,
          icon: category.icon,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
          contactCount: 0
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return duplicateCategoryResponse();
    }
    return categoryServerError(error);
  }
}
