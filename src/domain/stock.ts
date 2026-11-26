import type { InventoryLot } from "../model";
export const stockLevelText = (level?: number | null) =>
  level == null ? "未估计" : ["已用完", "缺乏", "充足", "盈余"][level + 1];
export const hasStock = (lot: InventoryLot) =>
  lot.stockPresent !== false &&
  (lot.measurement === "level" ? (lot.level ?? -1) >= 0 : lot.quantity > 0);

export const roughStockLevel = (lot: InventoryLot) =>
  hasStock(lot) ? (lot.level ?? 1) : -1;
