import mongoose from "mongoose";
import { NextResponse } from "next/server";

export function duplicateCategoryResponse() {
  return NextResponse.json(
    { error: { code: "CATEGORY_EXISTS", message: "A category with this name already exists." } },
    { status: 409 }
  );
}

export function categoryServerError(error: unknown) {
  console.error("Category API request failed.", error);
  if (error instanceof Error && error.message.includes("MONGODB_URI is not configured")) {
    return NextResponse.json(
      { error: { code: "DATABASE_NOT_CONFIGURED", message: "Database connection is not configured." } },
      { status: 503 }
    );
  }
  if (
    error instanceof Error &&
    (error.name === "MongooseServerSelectionError" || error.name === "MongoServerSelectionError")
  ) {
    return NextResponse.json(
      { error: { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable." } },
      { status: 503 }
    );
  }
  if (error instanceof mongoose.Error.ValidationError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Category data did not pass validation." } },
      { status: 400 }
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "The category request could not be completed." } },
    { status: 500 }
  );
}
