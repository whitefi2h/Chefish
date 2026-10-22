import { describe, it, expect } from "vitest";
import { selectedUrl } from "../src/services/aiClient";
describe("assistant URL authority", () => {
  it("rejects model invented links", () =>
    expect(() =>
      selectedUrl(
        {
          action: "import",
          message: "",
          url: "https://www.xiachufang.com/recipe/123/",
        },
        [],
      ),
    ).toThrow());
  it("accepts a link explicitly supplied by user", () =>
    expect(
      selectedUrl(
        {
          action: "import",
          message: "",
          url: "https://www.xiachufang.com/recipe/123/",
        },
        [],
        "整理 https://m.xiachufang.com/recipe/123/?from=test",
      ),
    ).toBe("https://www.xiachufang.com/recipe/123/"));
  it("rejects stale candidate identity", () =>
    expect(() =>
      selectedUrl({ action: "import", message: "", candidateId: "old" }, []),
    ).toThrow());
});
