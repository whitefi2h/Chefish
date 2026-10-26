import { expect, it } from "vitest";
import { ingredientCategory } from "../src/domain/ingredientCategory";
it("classifies common inventory names while leaving unknown names unclassified", () => {
  expect(ingredientCategory("新鲜大蒜")).toBe("蔬菜菌菇");
  expect(ingredientCategory("鸡胸肉")).toBe("肉禽蛋");
  expect(ingredientCategory("三文鱼")).toBe("水产海鲜");
  expect(ingredientCategory("AAA")).toBe("未分类");
});
