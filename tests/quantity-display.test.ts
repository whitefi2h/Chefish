import { expect, it } from "vitest";
import { quantityText } from "../src/domain/quantity";
it("quantities display at most one decimal without trailing zeros or false zero", () => {
  expect(
    ["0.666668", "191.666667", "333.333334", "1.0", "0", "0.0001"].map(
      quantityText,
    ),
  ).toEqual(["0.7", "191.7", "333.3", "1", "0", "<0.1"]);
});
