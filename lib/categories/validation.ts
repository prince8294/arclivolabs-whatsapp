import { isCategoryIconName, type CategoryIconName } from "@/lib/categories/icons";

export type CategoryInput = {
  name: string;
  description: string;
  icon: CategoryIconName;
  normalizedName: string;
  slug: string;
};

export type CategoryInputResult =
  | { ok: true; value: CategoryInput }
  | { ok: false; message: string };

export function validateCategoryInput(body: unknown): CategoryInputResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Request body must be an object." };
  }

  const values = body as Record<string, unknown>;
  const name = typeof values.name === "string" ? values.name.trim().replace(/\s+/g, " ") : "";
  const description =
    values.description === undefined
      ? ""
      : typeof values.description === "string"
        ? values.description.trim()
        : null;
  const icon = values.icon === undefined ? "building" : values.icon;

  if (!name || name.length > 80) {
    return { ok: false, message: "Category name must be between 1 and 80 characters." };
  }
  if (description === null || description.length > 280) {
    return { ok: false, message: "Description must be 280 characters or fewer." };
  }
  if (!isCategoryIconName(icon)) {
    return { ok: false, message: "Choose an available category icon." };
  }

  const slug =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "category";

  return {
    ok: true,
    value: {
      name,
      description,
      icon: icon as CategoryIconName,
      normalizedName: name.toLocaleLowerCase("en-US"),
      slug
    }
  };
}
