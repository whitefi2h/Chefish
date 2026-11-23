import { describe, it, expect } from "vitest";
import { initialState } from "../src/model";
import {
  expiringInventoryLots,
  inventoryStatus,
} from "../src/domain/inventory";

describe("estimated expiry reminders", () => {
  const lot = {
    ...initialState().lots[0],
    expires: "2026-11-20",
    measurement: "level" as const,
    level: 1,
    quantity: 0,
    stockPresent: true,
    steward: { estimatedExpires: "2026-11-20" },
  };
  it("includes estimated expiry in ordinary expiry reminders", () => {
    expect(expiringInventoryLots([lot], "2026-11-23")).toEqual([lot]);
    expect(inventoryStatus(lot, "2026-11-23")).toEqual({
      label: "已过期 3 天",
      tone: "red",
    });
  });
  it("excludes used up batches and distant expiry", () => {
    expect(
      expiringInventoryLots(
        [
          { ...lot, level: -1 },
          {
            ...lot,
            expires: "2026-12-01",
            steward: { estimatedExpires: "2026-12-01" },
          },
        ],
        "2026-11-23",
      ),
    ).toEqual([]);
  });
  it("actual expiry takes precedence over an AI estimate", () => {
    const expired = {
      ...lot,
      expires: "2026-11-21",
      steward: { estimatedExpires: "2026-12-01" },
    };
    expect(expiringInventoryLots([expired], "2026-11-23")).toEqual([expired]);
    expect(inventoryStatus(expired, "2026-11-23")).toEqual({
      label: "已过期 2 天",
      tone: "red",
    });
  });
  it("does not create review reminders from legacy metadata", () => {
    const legacy = {
      ...lot,
      expires: null,
      steward: { origin: "legacy", reviewOn: "2026-11-20" },
    };
    expect(expiringInventoryLots([legacy], "2026-11-23")).toEqual([]);
  });
});
