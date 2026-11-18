export type TemplateButtonInput = {
  type: "QUICK_REPLY" | "URL";
  text: string;
  url?: string;
};

export type TemplateInput = {
  name: string;
  businessCategoryId: string;
  metaCategory: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  header: string;
  body: string;
  footer: string;
  buttons: TemplateButtonInput[];
  variables: number[];
  variableSamples: Record<string, string>;
  variableMappings: { number: number; mapping: "contactPerson" | "businessName" | "city" | "" }[];
};

type ParseResult = { ok: true; value: TemplateInput } | { ok: false; message: string };

const supportedCategories = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
const allowedMappings = ["contactPerson", "businessName", "city", ""] as const;

export function extractTemplateVariables(body: string) {
  const found: number[] = [];
  const expression = /\{\{\s*(\d+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(body)) !== null) found.push(Number(match[1]));
  return [...new Set(found)].sort((a, b) => a - b);
}

export function validateTemplateInput(value: unknown): ParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Template details must be provided." };
  }
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim().toLowerCase() : "";
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    return { ok: false, message: "Use a template name with lowercase letters, numbers, or underscores only." };
  }
  const rawLanguage = typeof input.language === "string" ? input.language.trim() : "";
  if (!/^[a-z]{2,3}(?:_[a-z]{2,4})?$/i.test(rawLanguage)) {
    return { ok: false, message: "Enter a valid Meta language code, such as en or hi." };
  }
  const languageParts = rawLanguage.split("_");
  const language = languageParts.length === 2
    ? `${languageParts[0].toLowerCase()}_${languageParts[1].toUpperCase()}`
    : rawLanguage.toLowerCase();
  if (typeof input.metaCategory !== "string" || !supportedCategories.includes(input.metaCategory as (typeof supportedCategories)[number])) {
    return { ok: false, message: "Choose a valid Meta template category." };
  }
  const businessCategoryId = typeof input.businessCategoryId === "string" ? input.businessCategoryId : "";
  if (!businessCategoryId) return { ok: false, message: "Select a business category." };
  const header = typeof input.header === "string" ? input.header.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const footer = typeof input.footer === "string" ? input.footer.trim() : "";
  if (!body || body.length > 1024) return { ok: false, message: "Message body is required and must be 1,024 characters or fewer." };
  if (header.length > 60 || footer.length > 60) return { ok: false, message: "Header and footer must be 60 characters or fewer." };
  if (/\{\{|\}\}/.test(body.replace(/\{\{\s*\d+\s*\}\}/g, ""))) {
    return { ok: false, message: "Use numbered variables such as {{1}} in the message body." };
  }
  const variables = extractTemplateVariables(body);
  if (variables.some((number, index) => number !== index + 1)) {
    return { ok: false, message: "Numbered variables must start at {{1}} and continue without gaps." };
  }
  const sampleInput = input.variableSamples;
  const variableSamples: Record<string, string> = {};
  if (sampleInput && typeof sampleInput === "object" && !Array.isArray(sampleInput)) {
    for (const [key, sample] of Object.entries(sampleInput)) {
      if (typeof sample === "string") variableSamples[key] = sample.trim().slice(0, 1000);
    }
  }
  const mappingInput = Array.isArray(input.variableMappings) ? input.variableMappings : [];
  const variableMappings: TemplateInput["variableMappings"] = variables.map((number) => {
    const mapping = mappingInput.find((item) =>
      item && typeof item === "object" && "number" in item && item.number === number
    );
    const selected = mapping && typeof mapping === "object" && "mapping" in mapping ? mapping.mapping : "";
    return {
      number,
      mapping: typeof selected === "string" && allowedMappings.includes(selected as (typeof allowedMappings)[number])
        ? selected as TemplateInput["variableMappings"][number]["mapping"]
        : ""
    };
  });
  const buttonsInput = Array.isArray(input.buttons) ? input.buttons : [];
  if (buttonsInput.length > 3) return { ok: false, message: "Meta supports up to three buttons for this template." };
  const buttons: TemplateButtonInput[] = [];
  for (const item of buttonsInput) {
    if (!item || typeof item !== "object") return { ok: false, message: "Button details are invalid." };
    const button = item as Record<string, unknown>;
    const text = typeof button.text === "string" ? button.text.trim() : "";
    if (!text || text.length > 25) return { ok: false, message: "Button labels are required and must be 25 characters or fewer." };
    if (button.type === "QUICK_REPLY") {
      buttons.push({ type: "QUICK_REPLY", text });
    } else if (button.type === "URL") {
      const url = typeof button.url === "string" ? button.url.trim() : "";
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname) throw new Error();
      } catch {
        return { ok: false, message: "Website buttons require a valid HTTPS URL." };
      }
      if (buttons.length || buttonsInput.length > 1) {
        return { ok: false, message: "Use one website button on its own, or up to three quick reply buttons." };
      }
      buttons.push({ type: "URL", text, url });
    } else {
      return { ok: false, message: "Choose a supported quick reply or website button." };
    }
  }
  if (buttons.some((button) => button.type === "URL") && buttons.length !== 1) {
    return { ok: false, message: "A website button cannot be combined with other buttons." };
  }

  return {
    ok: true,
    value: {
      name,
      businessCategoryId,
      metaCategory: input.metaCategory as TemplateInput["metaCategory"],
      language,
      header,
      body,
      footer,
      buttons,
      variables,
      variableSamples,
      variableMappings
    }
  };
}

export function validateTemplateSamples(input: TemplateInput) {
  return input.variables.every((number) => Boolean(input.variableSamples[String(number)]?.trim()));
}
