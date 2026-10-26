import standards from "./ingredientStandards.json";
export function ingredientName(raw: string) {
  const name = raw.trim();
  return (
    standards.find((r) =>
      [r.name, ...r.aliases].some(
        (a) => a.toLowerCase() === name.toLowerCase(),
      ),
    )?.name ?? name
  );
}
export function normalizedAmount(
  rawName: string,
  quantity: number,
  rawUnit: string,
) {
  const name = ingredientName(rawName),
    u = rawUnit.trim().toLowerCase();
  const physical: Record<string, [string, number]> = {
    g: ["g", 1],
    克: ["g", 1],
    公克: ["g", 1],
    kg: ["g", 1000],
    千克: ["g", 1000],
    公斤: ["g", 1000],
    斤: ["g", 500],
    两: ["g", 50],
    ml: ["ml", 1],
    毫升: ["ml", 1],
    l: ["ml", 1000],
    升: ["ml", 1000],
  };
  if (physical[u])
    return {
      name,
      quantity: quantity * physical[u][1],
      unit: physical[u][0],
      estimated: false,
    };
  const rule = standards.find((r) => r.name === name),
    factor = (rule?.units as Partial<Record<string, number>> | undefined)?.[u];
  if (factor && !["个", "片", "盒"].includes(u))
    return {
      name,
      quantity: quantity * factor,
      unit: rule!.base,
      estimated: true,
    };
  return {
    name,
    quantity,
    unit: ["包", "袋", "瓶", "罐"].includes(u)
      ? "盒"
      : ["颗", "枚", "根", "只", "头", "瓣", "枝", "块", "份"].includes(u)
        ? "个"
        : u,
    estimated: false,
  };
}
export function unitFactor(name: string, from: string, to: string) {
  if (from === to) return 1;
  const rule = standards.find((r) => r.name === ingredientName(name));
  if (!rule) return undefined;
  const units = rule.units as Partial<Record<string, number>>;
  const a = from === rule.base ? 1 : units[from],
    b = to === rule.base ? 1 : units[to];
  return a && b ? a / b : undefined;
}
