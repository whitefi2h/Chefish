import { it, expect } from "vitest";
import { isSeasoning, setSupply, supplies } from "../src/domain/seasonings";
import { requestedSearchCount } from "../src/domain/assistantChat";
import { initialState } from "../src/fixtures/demo";
import { needs, weekOf } from "../src/model";

it("defaults searches to three and respects only explicit result counts", () => {
  expect(requestedSearchCount("帮我搜索番茄炒蛋", 10)).toBe(3);
  expect(requestedSearchCount("推荐十个家常菜")).toBe(10);
  expect(requestedSearchCount("推荐十二道家常菜")).toBe(12);
  expect(requestedSearchCount("推荐5")).toBe(5);
  expect(requestedSearchCount("帮我找5道菜")).toBe(5);
  expect(requestedSearchCount("安排2人份晚餐")).toBe(3);
});
it("classifies pantry seasonings without matching vegetables or dishes and permits correction", () => {
  expect(isSeasoning("味达美耗油")).toBe(true);
  expect(isSeasoning("白砂糖")).toBe(true);
  expect(isSeasoning("糖醋排骨")).toBe(false);
  expect(isSeasoning("胡椒粉", { 胡椒粉: false })).toBe(false);
  const state = setSupply(initialState(), "盐", true);
  expect(supplies(state)[0]).toMatchObject({ name: "盐", missing: true });
  expect(supplies(setSupply(state, "盐", false)).every((s) => !s.missing)).toBe(
    true,
  );
});
it("legacy exact seasoning quantities never become automatic shopping demand", () => {
  const s = initialState();
  s.ingredients.push({ id: "salt-test", name: "盐", category: "未分类" });
  s.recipes[0].requirements.push({
    ingredientId: "salt-test",
    quantity: 2,
    unit: "g",
  });
  s.plans = [
    {
      id: "test",
      recipeId: s.recipes[0].id,
      day: s.today ?? "2026-10-18",
      meal: "晚餐",
      servings: 2,
    },
  ];
  expect(
    needs(s, weekOf(s.plans[0].day)).some(
      (n) => n.ingredientId === "salt-test",
    ),
  ).toBe(false);
});

it("pantry groups spelling and brand aliases, and refilling clears the shared missing flag", () => {
  const s = initialState();
  s.seasonings = [
    { id: "蚝油", name: "蚝油", missing: false },
    { id: "味达美耗油", name: "味达美耗油", missing: true },
    { id: "食盐", name: "食盐", missing: false },
    { id: "盐", name: "盐", missing: false },
  ];
  expect(supplies(s)).toHaveLength(2);
  expect(supplies(s)[0]).toMatchObject({ name: "蚝油", missing: true });
  expect(supplies(setSupply(s, "耗油", false)).every((r) => !r.missing)).toBe(
    true,
  );
});
