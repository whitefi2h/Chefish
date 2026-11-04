import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const shots = new URL(
  "../../docs/screenshots/ingredient-icon-index/",
  import.meta.url,
);
await mkdir(shots, { recursive: true });
const shot = (name) =>
  page.screenshot({ path: fileURLToPath(new URL(name, shots)) });
const offlineRequests = [];
await page.route(/^https?:/, (route) => {
  offlineRequests.push(route.request().url());
  return route.abort();
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const url = new URL("../../docs/ingredient-icon-review.html", import.meta.url)
    .href;
  await page.goto(url);
  assert.equal(await page.locator(".entry").count(), 131);
  const assignmentsBefore = await page.evaluate(() =>
    localStorage.getItem("chefish:ingredient-icon-assignments:0.1.0"),
  );
  await page.reload();
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("chefish:ingredient-icon-assignments:0.1.0"),
    ),
    assignmentsBefore,
  );
  await page.locator("#research > summary").click();
  assert.equal(await page.locator(".research-preview").count(), 20);
  assert.equal(await page.locator(".research-row").count(), 30);
  await page
    .locator(".research-preview img")
    .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
  await page.getByLabel("搜索补缺研究").fill("木耳");
  assert.equal(await page.locator(".research-row").count(), 1);
  assert(
    (await page.locator(".research-row").textContent()).includes("いらすとや"),
  );
  await page.getByLabel("搜索补缺研究").fill("蒜薹");
  assert(
    (await page.locator(".research-row").textContent()).includes("文字头像"),
  );
  await page.getByLabel("搜索补缺研究").fill("");
  await shot("research-sources.png");
  await page.locator("#research > summary").click();
  await page
    .locator(".entry img")
    .evaluateAll(async (imgs) => Promise.all(imgs.map((img) => img.decode())));
  await shot("desktop.png");
  const tomatoAvatar = page.locator('[data-entry="tomato"] .avatar img');
  await tomatoAvatar.evaluate(
    (img) => (img.src = "data:image/png;base64,broken"),
  );
  await page.waitForFunction(
    () =>
      document.querySelector('[data-entry="tomato"] .avatar.text')
        ?.textContent === "番",
  );
  await page.reload();

  await page.getByLabel("搜索食材索引").fill("西红柿");
  assert.equal(await page.locator(".entry").count(), 1);
  assert(
    (await page.locator("#query-result").textContent()).includes("别名命中"),
  );
  await page.getByRole("button", { name: "检阅番茄", exact: true }).click();
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.locator(".candidate").count(), 2);
  await dialog.locator("[data-choose='twemoji:tomato']").click();
  await page.locator("#review-status").selectOption("accepted");
  await page
    .locator("#review-note")
    .fill("优先使用 Twemoji，留白更适合列表。<检阅文字>");
  await page.getByRole("button", { name: "保存检阅", exact: true }).click();
  await shot("detail.png");
  await page.getByRole("button", { name: "关闭检阅详情" }).click();
  await page.reload();
  await page.getByLabel("检阅状态").selectOption("accepted");
  assert.equal(await page.locator(".entry").count(), 1);
  assert((await page.locator(".entry").textContent()).includes("番茄"));
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出检阅记录", exact: true }).click();
  const file = await exported;
  const record = JSON.parse(await readFile(await file.path(), "utf8"));
  assert.equal(record.entries[0].iconId, "twemoji:tomato");
  assert.equal(record.entries[0].status, "accepted");
  assert(record.entries[0].note.includes("<检阅文字>"));

  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.getByLabel("搜索食材索引").fill("大蒜");
  await page.getByRole("button", { name: "检阅大蒜", exact: true }).click();
  assert(await dialog.locator("[data-choose='svgrepo:garlic']").isDisabled());
  await page.getByRole("button", { name: "关闭检阅详情" }).click();
  await page.getByLabel("搜索食材索引").fill("白玉菇");
  assert(
    (await page.locator("#query-result").textContent()).includes("类别代用"),
  );
  await shot("mushroom-category.png");
  await page.getByLabel("搜索食材索引").fill("金针菇");
  assert(
    (await page.locator("#query-result").textContent()).includes("精确图形"),
  );
  await page.getByRole("button", { name: "检阅金针菇", exact: true }).click();
  assert((await dialog.textContent()).includes("SOZAIC"));
  assert.equal(await dialog.locator(".candidate").count(), 2);
  await page.getByRole("button", { name: "关闭检阅详情" }).click();
  await page.getByLabel("搜索食材索引").fill("AAA");
  assert.equal(await page.locator(".entry").count(), 0);
  assert(
    (await page.locator("#query-result").textContent()).includes("未收录"),
  );
  await page.getByLabel("搜索食材索引").fill("蒜");
  assert(
    (await page.locator("#query-result").textContent()).includes("名称有歧义"),
  );
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.getByRole("button", { name: "文字头像", exact: true }).click();
  assert.equal(await page.locator(".entry").count(), 12);
  await page.locator(".entry").first().scrollIntoViewIfNeeded();
  await shot("pending.png");
  assert.equal(await page.locator(".entry .avatar.text").count(), 24);
  await page.getByRole("button", { name: "检阅泡打粉", exact: true }).click();
  assert(
    (await dialog.locator(".text-fallback-preview").textContent()).includes(
      "泡打",
    ),
  );
  await shot("text-detail.png");
  await page.getByRole("button", { name: "关闭检阅详情" }).click();
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.getByLabel("素材来源").selectOption("svgrepo");
  assert.equal(await page.locator(".entry").count(), 3);
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.getByLabel("食材分类").selectOption("水果");
  assert.equal(await page.locator(".entry").count(), 18);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await shot("mobile.png");
  await page.locator("#research > summary").click();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await shot("mobile-research.png");
  await page.locator("#research > summary").click();
  await page.getByRole("button", { name: "检阅苹果", exact: true }).click();
  assert(await page.getByRole("button", { name: "关闭检阅详情" }).isVisible());
  await page
    .getByRole("button", { name: "保存检阅", exact: true })
    .scrollIntoViewIfNeeded();
  await shot("mobile-detail.png");
  assert.deepEqual(errors, []);
  assert.deepEqual(offlineRequests, []);
  console.log(
    "Offline HTML verified: search/aliases, filters, candidate selection, persistence, JSON export, pending rights, unknown names and 390px layout.",
  );
} finally {
  await browser.close();
}
