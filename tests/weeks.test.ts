import { it, expect } from "vitest";
import {
  initialState,
  weekOf,
  weekDays,
  shiftDate,
  validDate,
  putMeal,
  needs,
  pendingItems,
  buy,
} from "../src/model";
it("calculates Monday weeks across years and leap dates with validated dates", () => {
  expect(weekOf("2027-01-01")).toBe("2026-12-28");
  expect(weekDays("2026-12-28").at(-1)).toBe("2027-01-03");
  expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
  expect(validDate("2026-02-30")).toBe(false);
  expect(validDate("2026-10-19")).toBe(true);
});
it("keeps past and future plans and purchase credit in separate weeks", () => {
  let s = initialState();
  const original = needs(s).find((n) => n.ingredientId === "beef")!.toBuy;
  s = putMeal(s, "steak", "2026-10-20", "晚餐", 4);
  s = putMeal(s, "soup", "2026-10-05", "晚餐");
  expect(needs(s).find((n) => n.ingredientId === "beef")!.toBuy).toBe(original);
  expect(
    needs(s, "2026-10-19").find((n) => n.ingredientId === "beef")!.toBuy,
  ).toBe(200);
  const item = pendingItems(s, "2026-10-19").find(
    (n) => n.ingredientId === "beef",
  )!;
  s = buy(s, item);
  expect(
    needs(s, "2026-10-19").find((n) => n.ingredientId === "beef")!.toBuy,
  ).toBe(0);
  expect(needs(s).find((n) => n.ingredientId === "beef")!.toBuy).toBe(original);
  expect(pendingItems(s).some((i) => i.id === s.shopping[0].id)).toBe(false);
  expect(s.plans.some((p) => p.day === "2026-10-05")).toBe(true);
});
