import rules from "./ingredientCategories.json";
export function ingredientCategory(name: string): string {
  const normalized = name.trim();
  return (
    rules.find((rule) => rule.names.some((word) => normalized.includes(word)))
      ?.category ?? "未分类"
  );
}
