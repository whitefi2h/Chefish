import { describe, it, expect } from "vitest";
import {
  initialState,
  needs,
  stock,
  pendingItems,
  buy,
  purchase,
  receive,
  putMeal,
  changeLot,
  daysLeft,
  expiryLabel,
  recipes,
  csvText,
  DAYS,
  type ShoppingItem,
} from "../src/model";
describe("shared demo invariants", () => {
  it("household purchase stocks confirmed attributes immediately without a pending receipt", () => {
    const s = initialState();
    const item = pendingItems(s).find((i) => i.name === "牛肉")!;
    const saved = purchase(s, item, {
      quantity: item.quantity,
      location: "冷冻",
      received: s.today!,
      expires: undefined,
    });
    const added = saved.shopping.find(
      (i) => !s.shopping.some((old) => old.id === i.id),
    )!;
    expect(added.status).toBe("stocked");
    expect(
      saved.lots.find((l) => l.id === `receipt:${added.id}`),
    ).toMatchObject({
      quantity: item.quantity,
      location: "冷冻",
      received: s.today,
      expires: null,
    });
    expect(
      pendingItems(saved).filter(
        (i) => i.name === "牛肉" && i.status === "pending",
      ),
    ).toHaveLength(0);
    expect(saved.shopping.filter((i) => i.status === "bought")).toHaveLength(0);
  });
  it("rough quantities and missing expiry count as ordinary inventory", () => {
    const state = initialState();
    state.lots = state.lots.map((lot) =>
      lot.ingredientId === "beef"
        ? { ...lot, expires: null, precision: "rough" }
        : lot,
    );
    const row = needs(state).find((item) => item.ingredientId === "beef")!;
    expect(row.covered).toBe(400);
    expect(row.toBuy).toBe(150);
    expect(row.review).toBe(false);
  });
  it("aggregates 300g and 250g beef minus 400g stock to 150g", () => {
    const row = needs(initialState()).find((n) => n.ingredientId === "beef")!;
    expect(row.required).toBe(550);
    expect(row.covered).toBe(400);
    expect(row.toBuy).toBe(150);
  });
  it("covered mushrooms are never counted as bought", () => {
    const s = initialState();
    const row = needs(s).find((n) => n.ingredientId === "mushroom")!;
    expect(row.required).toBe(200);
    expect(row.covered).toBe(200);
    expect(row.toBuy).toBe(0);
    expect(pendingItems(s).some((i) => i.ingredientId === "mushroom")).toBe(
      false,
    );
    expect(s.shopping).toHaveLength(0);
  });
  it("buying and receiving are separate and receipt is idempotent", () => {
    const s = initialState();
    const req = { ingredientId: "beef", quantity: 150, unit: "g" };
    const item = pendingItems(s).find((i) => i.ingredientId === "beef")!;
    const bought = buy(s, item);
    expect(stock(bought, req)).toBe(400);
    expect(needs(bought).find((i) => i.ingredientId === "beef")!.toBuy).toBe(0);
    expect(buy(bought, item)).toBe(bought);
    const received = receive(bought, bought.shopping[0].id);
    expect(stock(received, req)).toBe(550);
    expect(receive(received, bought.shopping[0].id)).toBe(received);
    expect(received.shopping[0].status).toBe("stocked");
  });
  it("removing a meal recomputes needs but preserves bought and manual entries", () => {
    const s = initialState();
    const item = pendingItems(s).find((i) => i.ingredientId === "beef")!;
    const bought = buy(s, item);
    const manual: ShoppingItem = {
      ...item,
      id: "manual",
      source: "manual",
      status: "pending",
    };
    const changed = {
      ...bought,
      shopping: [...bought.shopping, manual],
      plans: s.plans.filter((p) => p.recipeId !== "rice"),
    };
    expect(changed.shopping).toHaveLength(2);
    expect(needs(changed).find((i) => i.ingredientId === "beef")!.toBuy).toBe(
      0,
    );
  });
  it("moving a dish preserves other dishes in the target meal without consuming stock", () => {
    const s = initialState();
    const next = putMeal(s, "steak", DAYS[1], "午餐", 3, "p1");
    expect(
      next.plans.filter((p) => p.day === DAYS[1] && p.meal === "午餐"),
    ).toHaveLength(2);
    expect(next.plans.find((p) => p.id === "p1")!.servings).toBe(3);
    expect(next.lots).toBe(s.lots);
    expect(next.plans.some((p) => p.id === "p2")).toBe(true);
  });
  it("scales servings in the common requirements calculation", () => {
    const s = {
      ...initialState(),
      plans: [
        {
          id: "only",
          recipeId: "steak",
          day: DAYS[0],
          meal: "晚餐" as const,
          servings: 4,
        },
      ],
    };
    expect(needs(s).find((i) => i.ingredientId === "beef")!.required).toBe(600);
  });
  it("rejects invalid plan ids, dates and portions", () => {
    const s = initialState();
    expect(putMeal(s, "missing", DAYS[0], "早餐")).toBe(s);
    expect(putMeal(s, "steak", "invalid", "早餐")).toBe(s);
    expect(putMeal(s, "steak", DAYS[0], "早餐", 0)).toBe(s);
  });
  it("derives calendar differences from an explicit clock and handles unknown expiry", () => {
    expect(daysLeft("2026-10-20", "2026-10-18")).toBe(2);
    expect(expiryLabel("2025-05-16", "2026-10-18")).toMatch(/^已过期/);
    expect(daysLeft("2026-10-18", "2026-10-18")).toBe(0);
    expect(daysLeft(null, "2026-10-18")).toBeNaN();
    expect(expiryLabel(null, "2026-10-18")).toBe("—");
  });
  it("expired, incompatible and rough lots cannot silently cover exact demand", () => {
    const s = initialState();
    s.lots = s.lots.filter((l) => l.ingredientId !== "beef");
    s.lots.push(
      {
        id: "old",
        ingredientId: "beef",
        quantity: 999,
        unit: "g",
        expires: "2025-05-16",
        received: "2025-05-10",
        location: "冷冻",
        precision: "exact",
      },
      {
        id: "box",
        ingredientId: "beef",
        quantity: 1,
        unit: "盒",
        expires: "2026-10-25",
        received: "2026-10-18",
        location: "冷冻",
        precision: "rough",
      },
    );
    const row = needs(s).find((n) => n.ingredientId === "beef")!;
    expect(row.toBuy).toBe(550);
    expect(row.review).toBe(true);
    expect(recipes[0].seasoning).toContain("少许");
  });
  it("never makes inventory negative; changing a lot leaves others intact", () => {
    const s = initialState();
    expect(changeLot(s, "beef-1", -1)).toBe(s);
    expect(changeLot(s, "beef-1", NaN)).toBe(s);
    const next = changeLot(s, "mushroom-1", 50, "冷冻");
    expect(next.lots.find((l) => l.id === "mushroom-1")!.location).toBe("冷冻");
    expect(next.lots.find((l) => l.id === "mushroom-2")!.quantity).toBe(100);
  });
  it("exports quoted CSV and neutralizes spreadsheet formulas", () => {
    const item = { ...pendingItems(initialState())[0], name: '=1+1,"测试"' };
    const csv = csvText([item]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain('""测试""');
  });
});
