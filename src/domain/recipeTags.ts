import catalog from "../../resources/recipe-tags/catalog.v1.json";
import type { DemoState, Recipe } from "../model";

export const tagGroups = [
  { id: "cuisine", label: "菜系" },
  { id: "trait", label: "菜品特性" },
  { id: "method", label: "烹饪方法" },
  { id: "custom", label: "自定义" },
] as const;
export type TagGroup = (typeof tagGroups)[number]["id"];
export interface RecipeTag {
  id: string;
  group: TagGroup;
  label: string;
  aliases: string[];
  broaderIds: string[];
  enabled: boolean;
  deleted: boolean;
  builtin: boolean;
  defaultEnabled: boolean;
  section: string;
  description: string;
  position: number;
}
export const builtinRecipeTags: RecipeTag[] = catalog.tags.map(
  (t, position) => ({
    ...t,
    group: t.group as TagGroup,
    enabled: t.defaultEnabled,
    deleted: false,
    builtin: true,
    position,
  }),
);
export const tagsOf = (state: Pick<DemoState, "recipeTags">) =>
  state.recipeTags ?? builtinRecipeTags;
export function legacyTagId(label: string, tags: RecipeTag[]) {
  const name = label === "西式料理" ? "西餐" : label;
  const exact = tags.find((t) => !t.deleted && t.label === name);
  if (exact) return exact.id;
  const matches = tags.filter(
    (t) =>
      !t.deleted &&
      t.aliases.some((a) => a.toLocaleLowerCase() === name.toLocaleLowerCase()),
  );
  return matches.length === 1 ? matches[0].id : undefined;
}
export function recipeTagIds(recipe: Recipe, tags: RecipeTag[]) {
  if (recipe.tagIds)
    return recipe.tagIds.filter((id) =>
      tags.some((t) => t.id === id && !t.deleted),
    );
  const id = legacyTagId(recipe.category, tags);
  return id ? [id] : [];
}
export function legacyTags(recipe: Recipe, tags: RecipeTag[]) {
  return (
    recipe.legacyTags ??
    (recipe.tagIds === undefined &&
    recipe.category !== "未分类" &&
    !legacyTagId(recipe.category, tags)
      ? [recipe.category]
      : [])
  );
}
export function ancestors(
  id: string,
  tags: RecipeTag[],
  seen = new Set<string>(),
) {
  if (seen.has(id)) return seen;
  seen.add(id);
  tags
    .find((t) => t.id === id)
    ?.broaderIds.forEach((p) => ancestors(p, tags, seen));
  return seen;
}
export function displayRecipeTags(recipe: Recipe, tags: RecipeTag[]) {
  const shown = recipeTagIds(recipe, tags).flatMap((id) => {
    const t = tags.find((t) => t.id === id && !t.deleted);
    if (!t) return [];
    if (t.enabled) return [t];
    const parent = [...ancestors(id, tags)]
      .map((p) => tags.find((t) => t.id === p))
      .find((t) => t?.enabled && !t.deleted);
    return parent ? [parent] : [];
  });
  return [...new Map(shown.map((t) => [t.id, t])).values()]
    .filter(
      (t) =>
        !shown.some((o) => o.id !== t.id && ancestors(o.id, tags).has(t.id)),
    )
    .sort(
      (a, b) =>
        tagGroups.findIndex((g) => g.id === a.group) -
          tagGroups.findIndex((g) => g.id === b.group) ||
        a.position - b.position,
    );
}
export function matchesTags(
  recipe: Recipe,
  selected: string[],
  tags: RecipeTag[],
) {
  const expanded = new Set(
    recipeTagIds(recipe, tags)
      .filter((id) => tags.some((t) => t.id === id && !t.deleted))
      .flatMap((id) => [...ancestors(id, tags)]),
  );
  return tagGroups.every((g) => {
    const within = selected.filter((id) =>
      tags.some(
        (t) => t.id === id && t.group === g.id && t.enabled && !t.deleted,
      ),
    );
    return !within.length || within.some((id) => expanded.has(id));
  });
}
export function searchTag(t: RecipeTag, query: string, tags: RecipeTag[]) {
  return [
    t.label,
    ...t.aliases,
    ...[...ancestors(t.id, tags)].map(
      (id) => tags.find((v) => v.id === id)?.label ?? "",
    ),
  ]
    .join(" ")
    .toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase());
}
