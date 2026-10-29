// Installed, isolated QA app only. Never run against the personal kitchen.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url() === "http://tauri.localhost/");
assert(page, "QA WebView not found");
const call = async (name, args = {}) => {
  const result = await page.evaluate(
    async ({ name, args }) => {
      try {
        return { value: await window.__TAURI_INTERNALS__.invoke(name, args) };
      } catch (error) {
        return {
          error: {
            code: error?.code,
            message: error?.message ?? String(error),
          },
        };
      }
    },
    { name, args },
  );
  if (result.error)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
const backup = await call("kitchen_backup_status");
assert.match(
  backup.directory,
  /com\.chefish\.qa[\\/]/i,
  "Refusing to modify a production kitchen",
);
const execute = (command) =>
  call("kitchen_execute", { requestId: randomUUID(), command });
const path = "docs/fixtures/steward-native-evidence.json";
const stage = process.argv[2] ?? "prepare";
try {
  if (stage === "prepare") {
    const before = await call("kitchen_bootstrap");
    assert.equal(before.recipes.length, 0, "Expected a new QA kitchen");
    for (const [name, ingredient, quantity] of [
      ["清炒西兰花", "西兰花", "300"],
      ["蘑菇鸡肉", "鸡肉", "250"],
    ]) {
      await execute({
        type: "create_recipe",
        draft: {
          name,
          category: "家常菜",
          minutes: 20,
          servings: 2,
          subtitle: "合成验收菜谱",
          seasoning: "",
          ingredients: [{ name: ingredient, quantity, unit: "g" }],
          steps: ["处理食材后烹饪至熟"],
        },
      });
    }
    const today = new Date().toLocaleDateString("en-CA");
    for (const name of ["西兰花", "鸡肉"])
      await execute({
        type: "receive_lot",
        draft: {
          name,
          category: "自动分类",
          quantity: "500",
          unit: "g",
          location: "冷藏",
          received: today,
          expires: null,
          precision: "exact",
        },
      });
    const state = await call("kitchen_steward_state");
    await call("kitchen_steward_settings", {
      settings: {
        ...state.settings,
        enabled: true,
        weekly: true,
        weeklyDay: new Date().getDay(),
        weeklyTime: "00:00",
        weeklyNotify: true,
        maintenance: false,
        recommendations: false,
      },
    });
    for (let i = 0; i < 35; i++) {
      const s = await call("kitchen_steward_state");
      if (s.items.some((item) => item.kind === "weekly")) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const after = await call("kitchen_steward_state");
    assert.equal(
      after.items.filter((item) => item.kind === "weekly").length,
      1,
    );
    await call("kitchen_steward_settings", {
      settings: { ...after.settings, doNotDisturb: true },
    });
    writeFileSync(
      path,
      JSON.stringify(
        {
          date: "2026-10-28",
          qaDirectory: backup.directory,
          installed: true,
          scheduledWeeklyMessage: true,
          productionKitchenTouched: false,
        },
        null,
        2,
      ),
    );
    console.log(
      "Installed QA: scheduled inquiry persisted, quiet mode enabled, personal kitchen excluded.",
    );
  } else if (stage === "draft") {
    const d = await call("kitchen_steward_draft", {
      id: null,
      weekStart: null,
    });
    const saved = await call("kitchen_steward_reply", {
      id: d.id,
      version: d.version,
      message:
        "只安排周一和周二晚餐，两人。周一清炒西兰花，周二蘑菇鸡肉，只用这两份现有菜谱，其他天在外吃。",
    });
    assert.equal(saved.slots.length, 2);
    assert.equal((await call("kitchen_bootstrap")).plans.length, 0);
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    Object.assign(evidence, {
      draftId: saved.id,
      draftSlots: saved.slots,
      draftVersion: saved.version,
      liveModelDraft: true,
    });
    writeFileSync(path, JSON.stringify(evidence, null, 2));
    console.log(
      "Live model: two-day draft persisted without changing the official calendar.",
    );
  } else if (stage === "confirm") {
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    const d = await call("kitchen_steward_draft", {
      id: evidence.draftId,
      weekStart: null,
    });
    assert.deepEqual(d.slots, evidence.draftSlots);
    let preview = await call("kitchen_steward_preview", { id: d.id });
    const stock = (await call("kitchen_bootstrap")).lots[0];
    await execute({
      type: "change_lot",
      lot_id: stock.id,
      expected_version: stock.version,
      operation: "correct",
      quantity: "450",
      location: null,
      reason: "合成预览冲突验收",
    });
    await assert.rejects(() =>
      call("kitchen_steward_confirm", {
        id: d.id,
        version: d.version,
        expectedRevision: preview.expectedRevision,
      }),
    );
    assert.equal((await call("kitchen_bootstrap")).plans.length, 0);
    preview = await call("kitchen_steward_preview", { id: d.id });
    await call("kitchen_steward_confirm", {
      id: d.id,
      version: d.version,
      expectedRevision: preview.expectedRevision,
    });
    assert.equal((await call("kitchen_bootstrap")).plans.length, 2);
    assert.equal(
      (await call("kitchen_steward_draft", { id: d.id, weekStart: null }))
        .status,
      "confirmed",
    );
    Object.assign(evidence, {
      nativeRestartPreservedDraft: true,
      previewConflictPreservedDraft: true,
      confirmedCalendarRows: 2,
    });
    writeFileSync(path, JSON.stringify(evidence, null, 2));
    console.log(
      "Native restart, stale preview rejection and confirmed calendar/requirements passed.",
    );
  } else if (stage === "services") {
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    for (const kind of process.argv[3]
      ? [process.argv[3]]
      : ["maintenance", "recommendations"]) {
      try {
        await call("kitchen_steward_run", { kind });
        evidence[kind] = { completed: true };
      } catch (error) {
        evidence[kind] = {
          completed: false,
          message: String(error?.message ?? error),
        };
      }
    }
    const s = await call("kitchen_steward_state");
    assert.equal(s.settings.doNotDisturb, true);
    evidence.messageKinds = s.items.map((i) => i.kind);
    evidence.recommendedCandidates = s.items
      .filter((i) => i.kind === "recommendations")
      .flatMap((i) => i.payload.candidates ?? [])
      .map((c) => ({ title: c.title, url: c.url }));
    for (const c of evidence.recommendedCandidates)
      assert.match(c.url, /^https:\/\/www\.xiachufang\.com\/recipe\/\d+\/$/);
    writeFileSync(path, JSON.stringify(evidence, null, 2));
    console.log(
      JSON.stringify({
        maintenance: evidence.maintenance,
        recommendations: evidence.recommendations,
        candidates: evidence.recommendedCandidates.length,
        manualWorkDuringQuietMode: true,
      }),
    );
  } else throw new Error("Unknown native QA stage");
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
