export type SendableTemplate = {
  header: string;
  body: string;
  buttons: { type: "QUICK_REPLY" | "URL"; url?: string }[];
};

function variableNumbers(value: string) {
  return [...new Set([...value.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])))]
    .sort((a, b) => a - b);
}

export function buildTemplateSendComponents(template: SendableTemplate, variables: string[]) {
  const components: Record<string, unknown>[] = [];
  const headerVariables = variableNumbers(template.header);
  if (headerVariables.length) {
    components.push({
      type: "header",
      parameters: headerVariables.map((number) => ({ type: "text", text: variables[number - 1] ?? "" }))
    });
  }
  const bodyVariables = variableNumbers(template.body);
  if (bodyVariables.length) {
    components.push({
      type: "body",
      parameters: bodyVariables.map((number) => ({ type: "text", text: variables[number - 1] ?? "" }))
    });
  }
  template.buttons.forEach((button, index) => {
    const numbers = variableNumbers(button.url ?? "");
    if (button.type === "URL" && numbers.length) {
      components.push({
        type: "button",
        sub_type: "url",
        index: String(index),
        parameters: numbers.map((number) => ({ type: "text", text: variables[number - 1] ?? "" }))
      });
    }
  });
  return components;
}
