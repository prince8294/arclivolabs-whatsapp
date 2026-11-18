import { Types } from "mongoose";
import type { CampaignVariableMapping } from "@/lib/campaigns/audience";

export type CampaignInput = {
  name: string;
  description: string;
  categoryIds: string[];
  cities: string[];
  templateId: string;
  variableMappings: CampaignVariableMapping[];
};

export function parseCampaignInput(value: unknown, allowIncomplete = false):
  | { ok: true; value: CampaignInput }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Campaign details must be an object." };
  }
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!name || name.length > 120) return { ok: false, message: "Campaign name is required and must be 120 characters or fewer." };
  if (description.length > 1000) return { ok: false, message: "Campaign description must be 1,000 characters or fewer." };

  const rawIds = input.categoryIds ?? [];
  if (!Array.isArray(rawIds) || rawIds.length > 100 || rawIds.some((id) => typeof id !== "string" || !Types.ObjectId.isValid(id))) {
    return { ok: false, message: "Select valid business categories." };
  }
  const categoryIds = [...new Set(rawIds as string[])];
  if (!allowIncomplete && !categoryIds.length) return { ok: false, message: "Select at least one business category." };

  const rawCities = input.cities ?? [];
  if (!Array.isArray(rawCities) || rawCities.length > 200 || rawCities.some((city) => typeof city !== "string" || city.trim().length > 100)) {
    return { ok: false, message: "Choose valid city filters." };
  }
  const cities = [...new Set((rawCities as string[]).map((city) => city.trim()).filter(Boolean))];
  const templateId = typeof input.templateId === "string" ? input.templateId : "";
  if (templateId && !Types.ObjectId.isValid(templateId)) return { ok: false, message: "Choose a valid WhatsApp template." };

  const rawMappings = input.variableMappings ?? [];
  if (!Array.isArray(rawMappings) || rawMappings.length > 20) return { ok: false, message: "Variable mappings are invalid." };
  const variableMappings: CampaignVariableMapping[] = [];
  for (const raw of rawMappings) {
    if (!raw || typeof raw !== "object") return { ok: false, message: "Variable mappings are invalid." };
    const mapping = raw as Record<string, unknown>;
    if (
      typeof mapping.number !== "number" ||
      !Number.isInteger(mapping.number) ||
      mapping.number < 1 ||
      !["contactPerson", "businessName", "city"].includes(String(mapping.mapping))
    ) return { ok: false, message: "Choose a valid contact field for each template variable." };
    if (variableMappings.some((item) => item.number === mapping.number)) return { ok: false, message: "Template variable mappings cannot be duplicated." };
    variableMappings.push({ number: mapping.number, mapping: mapping.mapping as CampaignVariableMapping["mapping"] });
  }

  return { ok: true, value: { name, description, categoryIds, cities, templateId, variableMappings } };
}
