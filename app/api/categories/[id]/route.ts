import { Types } from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid, isSameOriginRequest } from "@/lib/auth/admin-session";
import { categoryServerError, duplicateCategoryResponse } from "@/lib/api/category-errors";
import { validateCategoryInput } from "@/lib/categories/validation";
import { getCategoryContactCounts } from "@/lib/data/category-counts";
import { connectToDatabase } from "@/lib/db/mongodb";
import Category from "@/lib/models/category";

type RouteContext = { params: { id: string } };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "INVALID_ID", message: "Category ID is invalid." } }, { status: 400 });
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
    const category = await Category.findById(params.id);
    if (!category) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Category was not found." } }, { status: 404 });
    }

    const duplicate = await Category.exists({
      _id: { $ne: category._id },
      normalizedName: parsed.value.normalizedName
    });
    if (duplicate) return duplicateCategoryResponse();

    const counts = await getCategoryContactCounts([category._id]);
    category.name = parsed.value.name;
    category.normalizedName = parsed.value.normalizedName;
    category.slug = parsed.value.slug;
    category.description = parsed.value.description;
    category.icon = parsed.value.icon;
    await category.save();

    return NextResponse.json({
      category: {
        _id: category._id.toString(),
        name: category.name,
        slug: category.slug,
        description: category.description,
        icon: category.icon,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
        contactCount: counts.get(category._id.toString()) ?? 0
      }
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return duplicateCategoryResponse();
    }
    return categoryServerError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Request origin is not allowed." } }, { status: 403 });
  }
  if (!isAdminSessionValid(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Admin sign-in is required." } }, { status: 401 });
  }
  if (!Types.ObjectId.isValid(params.id)) {
    return NextResponse.json({ error: { code: "INVALID_ID", message: "Category ID is invalid." } }, { status: 400 });
  }

  try {
    await connectToDatabase();
    const categoryId = new Types.ObjectId(params.id);
    const category = await Category.findById(categoryId).lean();
    if (!category) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Category was not found." } }, { status: 404 });
    }

    const counts = await getCategoryContactCounts([categoryId]);
    const contactCount = counts.get(categoryId.toString()) ?? 0;
    if (contactCount > 0) {
      return NextResponse.json(
        {
          error: {
            code: "CATEGORY_IN_USE",
            message: `This category has ${contactCount} contact${contactCount === 1 ? "" : "s"}. Reassign or uncategorize them before deleting it.`
          }
        },
        { status: 409 }
      );
    }

    await Category.deleteOne({ _id: categoryId });
    return NextResponse.json({ success: true });
  } catch (error) {
    return categoryServerError(error);
  }
}
