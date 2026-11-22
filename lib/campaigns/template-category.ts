export type CategoryLinkedTemplate = {
  _id: string;
  businessCategoryId: string;
};

export function templateMatchesCategory(
  template: CategoryLinkedTemplate | null | undefined,
  categoryId: string
) {
  return Boolean(categoryId && template?.businessCategoryId === categoryId);
}

export function templatesForCategory<T extends CategoryLinkedTemplate>(
  templates: T[],
  categoryId: string
) {
  if (!categoryId) return [];
  return templates.filter((template) => templateMatchesCategory(template, categoryId));
}
