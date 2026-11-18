function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isUsableTestTemplateComponents(components: unknown) {
  if (!Array.isArray(components)) return true;
  if (/\{\{\s*\d+\s*\}\}/.test(JSON.stringify(components))) return false;
  return !components.some(
    (component) =>
      isRecord(component) &&
      component.type === "HEADER" &&
      ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(String(component.format ?? "").toUpperCase())
  );
}
