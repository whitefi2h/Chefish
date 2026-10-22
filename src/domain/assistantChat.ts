export function requestedSearchCount(
  message: string,
  modelLimit?: number,
): number {
  const match =
    message.match(/([0-9一二两三四五六七八九十百]+)\s*(?:道|个|款|种|份|条)/) ??
    message.match(
      /(?:推荐|显示|返回|搜索|找|来)\s*([0-9一二两三四五六七八九十百]+)(?:$|\s)/,
    );
  if (!match) return 3;
  const raw = match[1];
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  let value = /^\d+$/.test(raw) ? Number(raw) : digits[raw];
  if (raw.includes("十")) {
    const [tens, ones] = raw.split("十");
    value = (digits[tens] ?? 1) * 10 + (digits[ones] ?? 0);
  }
  if (raw.includes("百")) value = 100;
  value ??= modelLimit ?? 3;
  return Number.isInteger(value) ? Math.min(50, Math.max(1, value)) : 3;
}
