import test from "node:test";
import { URL } from "node:url";
/* global structuredClone */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  lookupIngredient,
  searchEntries,
  eligibleCandidates,
  selectIngredientIcon,
  resolveIngredientAvatar,
} from "../tools/ingredient-icons/lookup.mjs";

const catalog = JSON.parse(
  await readFile(
    new URL("../resources/ingredient-icons/index.json", import.meta.url),
    "utf8",
  ),
);

test("normalized aliases select existing local candidates without a model", () => {
  assert.equal(lookupIngredient(catalog, "西红柿").entryId, "tomato");
  assert.equal(
    lookupIngredient(catalog, "  Ｓｐａｇｈｅｔｔｉ  ").entryId,
    "spaghetti",
  );
  assert.equal(lookupIngredient(catalog, "番茄酱").entryId, "ketchup");
  assert.notEqual(lookupIngredient(catalog, "番茄酱").iconId, "fluent:tomato");
  assert.equal(lookupIngredient(catalog, "蒜苗").iconId, null);
});

test("category substitutes, pending artwork, unknown and ambiguous names stay distinct", () => {
  assert.equal(lookupIngredient(catalog, "白玉菇").status, "category");
  assert.equal(
    lookupIngredient(catalog, "白玉菇", { random: () => 0 }).iconId,
    "fluent:mushroom-brown",
  );
  assert.equal(lookupIngredient(catalog, "金针菇").status, "exact");
  assert.equal(lookupIngredient(catalog, "蒜薹").status, "pending");
  assert.equal(lookupIngredient(catalog, "未收录的复合调料").status, "unknown");
  assert.equal(lookupIngredient(catalog, "蒜").status, "ambiguous");
  assert.equal(lookupIngredient(catalog, " ").status, "unknown");
});

test("avatar priority preserves user images, uses color candidates and falls back to curated text", () => {
  assert.equal(
    resolveIngredientAvatar(catalog, "豆腐", { userImageUrl: "my-tofu.png" })
      .source,
    "user",
  );
  assert.equal(
    resolveIngredientAvatar(catalog, "豆腐").iconId,
    "irasutoya:tofu",
  );
  const powder = resolveIngredientAvatar(catalog, "泡打粉");
  assert.equal(powder.type, "text");
  assert.equal(powder.label, "泡");
  assert.deepEqual(resolveIngredientAvatar(catalog, "泡打粉"), powder);
  assert.equal(
    resolveIngredientAvatar(catalog, "未收录的复合调味品").label,
    "未",
  );
  const missing = structuredClone(catalog);
  for (const a of missing.assets.filter((a) => a.subject === "tomato"))
    a.selectionStatus = "reference-only";
  assert.equal(resolveIngredientAvatar(missing, "西红柿").label, "番");
});

test("outline artwork is excluded even with a recorded license and stored assignment", () => {
  const sample = structuredClone(catalog);
  sample.assets.find((a) => a.id === "fluent:tomato").visualStyle = "outline";
  const result = resolveIngredientAvatar(sample, "番茄", {
    existingIconId: "fluent:tomato",
  });
  assert.equal(result.iconId, "twemoji:tomato");
});

test("category selection can reach every allowed substitute and retains a stored choice", () => {
  const entry = catalog.entries.find((e) => e.id === "shimeji");
  const ids = eligibleCandidates(catalog, entry).map((c) => c.iconId);
  for (const [i, id] of ids.entries()) {
    const selected = selectIngredientIcon(catalog, entry, {
      random: () => (i + 0.5) / ids.length,
    });
    assert.equal(selected.iconId, id);
    assert.equal(
      selectIngredientIcon(catalog, entry, {
        existingIconId: id,
        random: () => {
          throw new Error("stored selection should not reroll");
        },
      }).iconId,
      id,
    );
  }
  const garlic = catalog.entries.find((e) => e.id === "minced-garlic");
  assert.notEqual(
    selectIngredientIcon(catalog, garlic, {
      existingIconId: "svgrepo:garlic",
      random: () => 0.99,
    }).iconId,
    "svgrepo:garlic",
  );
  assert.equal(
    selectIngredientIcon(
      catalog,
      catalog.entries.find((e) => e.id === "tomato"),
      {
        random: () => {
          throw new Error("exact entries should use their preferred icon");
        },
      },
    ).iconId,
    "fluent:tomato",
  );
});

test("retrieval suggestions never turn substring matches into an automatic selection", () => {
  assert(searchEntries(catalog, "大蒜").some((e) => e.id === "garlic"));
  assert.equal(lookupIngredient(catalog, "蒜").iconId, null);
  assert.equal(lookupIngredient(catalog, "有机番茄汁").iconId, null);
  assert.equal(lookupIngredient(catalog, "盐焗鸡").iconId, null);
});

test("blocked mushroom and pending-rights assets cannot become defaults", () => {
  const garlic = structuredClone(
    catalog.entries.find((e) => e.id === "garlic"),
  );
  garlic.candidates.push({
    iconId: "fluent:mushroom-red",
    kind: "exact",
    reason: "test",
  });
  const allowed = eligibleCandidates(catalog, garlic).map((c) => c.iconId);
  assert(!allowed.includes("fluent:mushroom-red"));
  assert(!allowed.includes("svgrepo:garlic"));
  assert(
    lookupIngredient(catalog, "大蒜").referenceIconIds.includes(
      "svgrepo:garlic",
    ),
  );
});

test("every catalog name resolves to its own entry and every selected asset is eligible", () => {
  for (const entry of catalog.entries) {
    for (const name of [entry.name, ...entry.aliases]) {
      const result = lookupIngredient(catalog, name);
      assert.equal(result.entryId, entry.id, name);
      if (result.iconId)
        assert(
          eligibleCandidates(catalog, entry).some(
            (c) => c.iconId === result.iconId,
          ),
        );
      assert(!catalog.policy.forbiddenFoodIconIds.includes(result.iconId));
    }
  }
});
