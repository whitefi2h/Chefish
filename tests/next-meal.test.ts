import { it, expect } from "vitest";
import { nextMeal, nextMealDishes } from "../src/domain/nextMeal";
import type { PlannedMeal } from "../src/model";
const plans = ["早餐", "午餐", "晚餐"].map((meal, i) => ({
  id: String(i),
  recipeId: "dish",
  day: "2026-10-26",
  meal,
  servings: 2,
})) as PlannedMeal[];
it("selects meals by local time and skips completed dishes", () => {
  expect(nextMeal(plans, "2026-10-26", 8 * 60)?.meal).toBe("早餐");
  expect(nextMeal(plans, "2026-10-26", 11 * 60)?.meal).toBe("午餐");
  expect(nextMeal(plans, "2026-10-26", 18 * 60)?.meal).toBe("晚餐");
  expect(nextMeal(plans, "2026-10-26", 22 * 60)).toBeUndefined();
  const cooked = {
    ...plans[1],
    cooking: {
      id: "done",
      date: "2026-10-26",
      servings: 2,
      note: "",
      untracked: false,
    },
  };
  expect(
    nextMeal([plans[0], cooked, plans[2]], "2026-10-26", 11 * 60)?.meal,
  ).toBe("晚餐");
  expect(
    nextMeal(
      [cooked, { ...plans[0], id: "tomorrow", day: "2026-10-27" }],
      "2026-10-26",
      22 * 60,
    )?.id,
  ).toBe("tomorrow");
});
it("groups all unfinished dishes from the earliest upcoming meal in plan order", () => {
  const dinner = plans[2];
  const done = {
    ...dinner,
    id: "done",
    cooking: {
      id: "done",
      date: "2026-10-26",
      servings: 2,
      note: "",
      untracked: false,
    },
  };
  const grouped = nextMealDishes(
    [
      plans[1],
      dinner,
      { ...dinner, id: "second" },
      done,
      { ...dinner, id: "third" },
      { ...dinner, id: "tomorrow", day: "2026-10-27" },
    ],
    "2026-10-26",
    18 * 60,
  );
  expect(grouped.map((p) => p.id)).toEqual([dinner.id, "second", "third"]);
});
