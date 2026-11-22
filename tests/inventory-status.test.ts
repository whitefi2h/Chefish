import { describe, it, expect } from "vitest";
import { initialState } from "../src/model";
import {
  expiringInventoryLots,
  inventoryStatus,
} from "../src/domain/inventory";

describe("estimated inventory review reminders", () => {
  const lot = {
    ...initialState().lots[0],
    expires: null,
    measurement: "level" as const,
    level: 1,
    quantity: 0,
    stockPresent: true,
    steward: { reviewOn: "2026-11-20" },
  };
  it("includes overdue reviews without calling them expired", () => {
    expect(expiringInventoryLots([lot], "2026-11-23")).toEqual([lot]);
    expect(inventoryStatus(lot, "2026-11-23")).toEqual({
      label: "待复查",
      tone: "warm",
    });
  });
  it("excludes used up batches and distant reviews", () => {
    expect(
      expiringInventoryLots(
        [
          { ...lot, level: -1 },
          { ...lot, steward: { reviewOn: "2026-12-01" } },
        ],
        "2026-11-23",
      ),
    ).toEqual([]);
  });
  it("actual expiry takes precedence over an AI estimate", () => {
    const expired = {
      ...lot,
      expires: "2026-11-21",
      steward: { reviewOn: "2026-12-01" },
    };
    expect(expiringInventoryLots([expired], "2026-11-23")).toEqual([expired]);
    expect(inventoryStatus(expired, "2026-11-23")).toEqual({
      label: "已过期 2 天",
      tone: "red",
    });
  });
});
