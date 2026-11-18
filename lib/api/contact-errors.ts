import mongoose from "mongoose";
import { NextResponse } from "next/server";

export function contactServerError(error: unknown) {
  console.error("Contact API request failed.", error);
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
  if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Contact data did not pass validation." } },
      { status: 400 }
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "The contact request could not be completed." } },
    { status: 500 }
  );
}

export function duplicatePhoneResponse() {
  return NextResponse.json(
    { error: { code: "PHONE_NUMBER_EXISTS", message: "A contact with this WhatsApp number already exists." } },
    { status: 409 }
  );
}
