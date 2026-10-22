import { it, expect } from "vitest";
import { initialState, putMeal, needs, DAYS } from "../src/model";
import { addRecipe, parseRecipe, example } from "../src/RecipeEditor";
import { changeCategory } from "../src/CategoryManager";
it("recipe editing preserves pinned demo plans and all earlier versions", () => {
  let s = addRecipe(initialState(), example);
  const original = s.recipes.at(-1)!;
  s = putMeal(s, original.id, DAYS[0], "午餐", 2);
  s = addRecipe(
    s,
    {
      ...example,
      name: "新配方",
      ingredients: [{ name: "西兰花", quantity: 600, unit: "g" }],
    },
    original,
  );
  expect(s.plans.at(-1)!.recipeSnapshot!.name).toBe(example.name);
  expect(s.plans.at(-1)!.recipeSnapshot!.requirements[0].quantity).toBe(300);
  expect(s.recipes.at(-1)!.revisionNumber).toBe(2);
  expect(s.recipeHistory![0]).toEqual(original);
});
it("dynamic recipes contribute to cumulative demand in a shared meal", () => {
  let s = addRecipe(initialState(), example);
  const r = s.recipes.at(-1)!;
  s = putMeal(s, r.id, DAYS[0], "晚餐", 4);
  expect(
    s.plans.filter((p) => p.day === DAYS[0] && p.meal === "晚餐"),
  ).toHaveLength(2);
  expect(needs(s).find((n) => n.name === "西兰花")!.required).toBe(600);
  expect(s.inspiration).not.toContain(r.id);
});
it("import rejects malformed quantities and preserves nonnumeric seasoning", () => {
  expect(() =>
    parseRecipe(JSON.stringify({ ...example, servings: 0 })),
  ).toThrow();
  expect(() =>
    parseRecipe(
      JSON.stringify({
        ...example,
        ingredients: [{ name: "菜", quantity: -1, unit: "g" }],
      }),
    ),
  ).toThrow();
  expect(parseRecipe(JSON.stringify(example)).seasoning).toBe("盐少许");
});
it("category rename and removal migrate associated data", () => {
  const s = initialState();
  const renamed = changeCategory(s, "ingredient", "肉禽蛋", "蛋白质");
  expect(renamed.ingredients.find((i) => i.id === "beef")!.category).toBe(
    "蛋白质",
  );
  const removed = changeCategory(renamed, "ingredient", "蛋白质", "");
  expect(removed.ingredientCategories).not.toContain("蛋白质");
  expect(removed.ingredients.find((i) => i.id === "beef")!.category).toBe(
    "未分类",
  );
  expect(changeCategory(s, "recipe", "家常菜", "西式料理")).toBe(s);
});
