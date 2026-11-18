import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { categoryIconOptions } from "@/lib/categories/icons";

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    normalizedName: { type: String, required: true, unique: true, select: false },
    slug: { type: String, required: true, index: true },
    description: { type: String, default: "", trim: true, maxlength: 280 },
    icon: {
      type: String,
      required: true,
      enum: categoryIconOptions.map((option) => option.name),
      default: "building"
    }
  },
  { timestamps: true }
);

export type CategoryDocument = InferSchemaType<typeof categorySchema>;

const Category =
  (mongoose.models.Category as Model<CategoryDocument> | undefined) ??
  mongoose.model<CategoryDocument>("Category", categorySchema);

export default Category;
