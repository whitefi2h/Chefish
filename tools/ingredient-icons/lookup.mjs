// Shared by the Node query command and the offline review page.
export function normalizeName(value) {
  return String(value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ");
}

export function eligibleCandidates(catalog, entry) {
  const forbidden = new Set([
    ...catalog.policy.forbiddenFoodIconIds,
    ...entry.forbiddenIconIds,
  ]);
  return entry.candidates.filter((candidate) => {
    const asset = catalog.assets.find((a) => a.id === candidate.iconId);
    const library = catalog.libraries.find((l) => l.id === asset?.library);
    return (
      asset?.selectionStatus === "candidate" &&
      ["license-recorded", "application-use-recorded"].includes(
        library?.distributionStatus,
      ) &&
      asset.visualStyle !== "outline" &&
      !forbidden.has(candidate.iconId)
    );
  });
}

export function textAvatar(catalog, name, entry = null) {
  const tone =
    catalog.avatar.tones[entry?.category] ?? catalog.avatar.defaultTone;
  return {
    type: "text",
    source: "fallback",
    label: Array.from(name.trim())[0] ?? "食",
    name,
    background: tone.background,
    color: tone.color,
  };
}

export function resolveIngredientAvatar(catalog, query, selection = {}) {
  if (selection.userImageUrl)
    return {
      type: "image",
      source: "user",
      url: selection.userImageUrl,
      name: query,
    };
  const result = lookupIngredient(catalog, query, selection);
  const entry = catalog.entries.find((e) => e.id === result.entryId);
  return result.iconId
    ? {
        type: "image",
        source: "catalog",
        iconId: result.iconId,
        name: result.name,
      }
    : textAvatar(catalog, result.name ?? query, entry);
}

export function searchEntries(catalog, query, limit = 12) {
  const q = normalizeName(query);
  if (!q) return catalog.entries.slice(0, limit);
  return catalog.entries
    .map((entry) => {
      const name = normalizeName(entry.name);
      const aliases = entry.aliases.map(normalizeName);
      const score =
        name === q
          ? 100
          : aliases.includes(q)
            ? 90
            : name.includes(q)
              ? 60
              : aliases.some((a) => a.includes(q))
                ? 50
                : normalizeName(`${entry.id} ${entry.category}`).includes(q)
                  ? 20
                  : 0;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.entry);
}

export function selectIngredientIcon(
  catalog,
  entry,
  { existingIconId = null, random = Math.random } = {},
) {
  const candidates = eligibleCandidates(catalog, entry);
  const existing = candidates.find((c) => c.iconId === existingIconId);
  if (existing) return existing;
  if (entry.matchKind === "category") {
    const substitutes = candidates.filter((c) => c.kind === "category");
    return substitutes[Math.floor(random() * substitutes.length)];
  }
  return (
    candidates.find((c) => c.iconId === entry.defaultIcon) ?? candidates[0]
  );
}

export function lookupIngredient(catalog, query, selection = {}) {
  const q = normalizeName(query);
  const matches = catalog.entries.filter((entry) =>
    [entry.name, ...entry.aliases].some((name) => normalizeName(name) === q),
  );
  const ambiguous = catalog.policy.ambiguousNames.some(
    (name) => normalizeName(name) === q,
  );
  if (ambiguous || matches.length > 1) {
    return {
      query,
      status: "ambiguous",
      needsLLM: true,
      iconId: null,
      reason: "名称含义不唯一，先判断食材身份；不自动选图。",
      suggestions: searchEntries(catalog, q, 6).map((e) => e.id),
    };
  }
  if (!q || !matches.length) {
    return {
      query,
      status: "unknown",
      needsLLM: true,
      iconId: null,
      reason: "索引没有名称或别名命中；搜索候选仅供检索，不等于匹配。",
      suggestions: q ? searchEntries(catalog, q, 6).map((e) => e.id) : [],
    };
  }
  const entry = matches[0];
  const candidates = eligibleCandidates(catalog, entry);
  const preferred = selectIngredientIcon(catalog, entry, selection);
  const status = preferred?.kind ?? "pending";
  return {
    query,
    entryId: entry.id,
    name: entry.name,
    matchedBy: normalizeName(entry.name) === q ? "name" : "alias",
    status,
    needsLLM: false,
    iconId: preferred?.iconId ?? null,
    candidateIconIds: candidates.map((c) => c.iconId),
    referenceIconIds: entry.candidates
      .filter((c) => !candidates.includes(c))
      .map((c) => c.iconId),
    reason: entry.notes || preferred?.reason || "已识别食材，但暂无合适图形。",
    reviewStatus: entry.reviewStatus,
    selectionMode: preferred
      ? entry.matchKind === "category"
        ? "random-once-then-retain"
        : "preferred"
      : "none",
  };
}
