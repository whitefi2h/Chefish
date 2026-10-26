import names from "./seasoningNames.json";
import type { DemoState, IngredientImage } from "../model";

// Match whole ingredient names or a branded suffix, never vegetable names containing a seasoning word.
export function isSeasoning(
  name: string,
  kinds?: Record<string, boolean>,
): boolean {
  const n = name.trim();
  if (kinds && Object.hasOwn(kinds, n)) return kinds[n];
  return (
    names.some((s) => n.replaceAll("耗", "蚝").endsWith(s)) ||
    n === "油" ||
    n === "醋"
  );
}
export interface SeasoningSupply {
  id: string;
  name: string;
  missing: boolean;
  image?: IngredientImage;
}
export function canonicalSeasoning(name: string): string {
  const n = name.trim().replaceAll("耗", "蚝");
  if (n.endsWith("糖")) return "糖";
  return (
    names.filter((s) => n.endsWith(s)).sort((a, b) => b.length - a.length)[0] ??
    n
  );
}
export function supplies(state: DemoState): SeasoningSupply[] {
  const rows: SeasoningSupply[] = [
    ...(state.seasonings ??
      ["盐", "糖", "生抽", "老抽", "蚝油", "料酒", "醋", "食用油"].map(
        (name) => ({ id: name, name, missing: false }),
      )),
  ];
  const grouped = new Map<string, SeasoningSupply>();
  for (const row of rows) {
    const name = canonicalSeasoning(row.name);
    grouped.set(name, {
      id: name,
      name,
      missing: row.missing || grouped.get(name)?.missing || false,
      image:
        row.image ??
        grouped.get(name)?.image ??
        state.ingredients.find((i) => canonicalSeasoning(i.name) === name)
          ?.image,
    });
  }
  return [...grouped.values()].sort(
    (a, b) =>
      Number(b.missing) - Number(a.missing) ||
      a.name.localeCompare(b.name, "zh"),
  );
}
export function setSupply(
  state: DemoState,
  name: string,
  missing: boolean,
): DemoState {
  name = canonicalSeasoning(name);
  const previous = supplies(state);
  return {
    ...state,
    seasonings: [
      ...previous.filter((s) => s.name !== name),
      {
        id: name,
        name,
        missing,
        image: previous.find((s) => s.name === name)?.image,
      },
    ],
  };
}
