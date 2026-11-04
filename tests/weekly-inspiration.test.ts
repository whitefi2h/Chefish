import { it, expect } from "vitest";
import { initialState } from "../src/model";
import {
  inspirationForWeek,
  toggleWeeklyInspiration,
} from "../src/domain/weeklyInspiration";
it("new weeks start empty while old lists and manually prepared future weeks remain isolated", () => {
  const s = initialState();
  expect(inspirationForWeek(s, "2026-10-12")).toHaveLength(6);
  expect(
    inspirationForWeek({ ...s, today: "2026-10-19" }, "2026-10-19"),
  ).toEqual([]);
  const next = toggleWeeklyInspiration(s, "2026-10-19", s.recipes[0].id, true);
  expect(inspirationForWeek(next, "2026-10-19")).toEqual([s.recipes[0].id]);
  expect(inspirationForWeek(next, "2026-10-12")).toHaveLength(6);
  expect(inspirationForWeek(next, "2026-10-26")).toEqual([]);
  expect(next.plans).toEqual(s.plans);
});
