export interface IngredientRow {
  name: string;
  amountText: string;
}
import { ingredientName, normalizedAmount } from "./ingredientStandards";

// Display all amounts together; only unambiguous supported units enter stock calculations.
export function splitIngredientRows(rows: IngredientRow[]) {
  const ingredients: { name: string; quantity: number; unit: string }[] = [];
  const textIngredients: IngredientRow[] = [];
  for (const row of rows) {
    const name = ingredientName(row.name);
    const amountText = row.amountText.trim();
    if (!name && !amountText) continue;
    if (!name || !amountText) throw new Error("请填写食材名称和用量。");
    const match = amountText.match(
      /^(\d+(?:\.\d+)?)\s*(kg|千克|公斤|公克|克|g|毫升|ml|升|l|斤|两|个|片|盒|包|袋|瓶|罐|瓣|头|根|只|枚|颗|枝|块|份)$/i,
    );
    if (!match) {
      textIngredients.push({ name, amountText });
      continue;
    }
    const u = match[2].toLowerCase();
    const multiplier = ["kg", "千克", "公斤", "升", "l"].includes(u)
      ? 1000
      : u === "斤"
        ? 500
        : 1;
    const quantity = Number((Number(match[1]) * multiplier).toFixed(9));
    if (
      quantity <= 0 ||
      quantity > 100000 ||
      Math.abs(quantity * 1e6 - Math.round(quantity * 1e6)) > 0.00001
    )
      throw new Error(`${name}：用量须大于零、最多六位小数且不超过 100000。`);
    const unit = ["kg", "千克", "公斤", "克", "g", "斤"].includes(u)
      ? "g"
      : ["毫升", "ml", "升", "l"].includes(u)
        ? "ml"
        : u;
    const normalized = normalizedAmount(name, quantity, unit);
    ingredients.push({
      name: normalized.name,
      quantity: normalized.quantity,
      unit: normalized.unit,
    });
  }
  return { ingredients, textIngredients };
}
