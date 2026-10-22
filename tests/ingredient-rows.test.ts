import { describe, it, expect } from "vitest";
import { splitIngredientRows } from "../src/domain/ingredientRows";
describe("one ingredients list", () => {
  it("separates calculations internally while preserving cooking amounts", () => {
    const out = splitIngredientRows([
      { name: "肉", amountText: "0.15 kg" },
      { name: "蒜末", amountText: "3瓣" },
      { name: "盐", amountText: "少许" },
    ]);
    expect(out.ingredients).toEqual([{ name: "肉", quantity: 150, unit: "g" }]);
    expect(out.textIngredients).toEqual([
      { name: "蒜末", amountText: "3瓣" },
      { name: "盐", amountText: "少许" },
    ]);
  });
  it("supports editing between numeric and free quantities without guessing", () => {
    expect(
      splitIngredientRows([{ name: "盐", amountText: "2克" }]).ingredients[0]
        .quantity,
    ).toBe(2);
    expect(
      splitIngredientRows([{ name: "盐", amountText: "1/2小勺" }])
        .textIngredients[0].amountText,
    ).toBe("1/2小勺");
    expect(() =>
      splitIngredientRows([{ name: "盐", amountText: "0g" }]),
    ).toThrow();
    expect(() =>
      splitIngredientRows([{ name: "盐", amountText: "0.0000001g" }]),
    ).toThrow();
  });
});
