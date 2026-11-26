import { splitIngredientRows } from "./ingredientRows";
import type { RecipeDraft } from "../RecipeEditor";

export function canonicalRecipeUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    ![
      "www.xiachufang.com",
      "m.xiachufang.com",
      "xiachufang.com",
      "hanwuji.xiachufang.com",
    ].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/recipe\/\d{1,20}\/?$/.test(url.pathname)
  )
    throw new Error("请填写完整的下厨房菜谱链接（https）");
  return `https://www.xiachufang.com${url.pathname.replace(/\/$/, "")}/`;
}

type Node = Record<string, unknown>;
function object(v: unknown): v is Node {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function recipes(v: unknown): Node[] {
  if (Array.isArray(v)) return v.flatMap(recipes);
  if (!object(v)) return [];
  const types = Array.isArray(v["@type"]) ? v["@type"] : [v["@type"]];
  return types.includes("Recipe") ? [v] : recipes(v["@graph"]);
}
type SourceStep = { title: string; body: string; image?: string };

function instructions(v: unknown): SourceStep[] {
  if (Array.isArray(v)) return v.flatMap(instructions);
  if (typeof v === "string") return [{ title: "", body: v.trim() }];
  if (!object(v)) return [];
  if (v.itemListElement) return instructions(v.itemListElement);
  const body = typeof v.text === "string" ? v.text.trim() : "";
  return body
    ? [
        {
          body,
          image: imageUrl(v.image),
          title: typeof v.name === "string" && v.name !== body ? v.name : "",
        },
      ]
    : [];
}

export function parseRecipeHtml(
  html: string,
  inputUrl: string,
): { draft: RecipeDraft; warnings: string[] } {
  if (new TextEncoder().encode(html).length > 2_000_000)
    throw new Error("HTML 文件需小于 2 MB");
  const url = canonicalRecipeUrl(inputUrl);
  // Template content stays detached and inert: imported scripts and media never enter the page.
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const text = (selector: string) =>
    root.querySelector(selector)?.textContent?.trim() ?? "";
  let data: Node | undefined;
  for (const script of root.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    try {
      data = recipes(JSON.parse(script.textContent ?? ""))[0];
    } catch {
      /* Try the site's visible recipe markup instead. */
    }
    if (data) break;
  }
  const name =
    typeof data?.name === "string"
      ? data.name
      : text("h1.page-title, h1[itemprop=name]");
  const authorData = data?.author;
  const author =
    typeof authorData === "string"
      ? authorData
      : object(authorData) && typeof authorData.name === "string"
        ? authorData.name
        : Array.isArray(authorData) &&
            object(authorData[0]) &&
            typeof authorData[0].name === "string"
          ? authorData[0].name
          : text(".author .name");
  const tableRows = [...root.querySelectorAll(".ings tr")]
    .map((row) => ({
      name: row.querySelector(".name")?.textContent?.trim() ?? "",
      amountText:
        row.querySelector(".unit")?.textContent?.trim() || "未注明用量",
    }))
    .filter((row) => row.name);
  const raw = tableRows.length
    ? tableRows.map((row) => `${row.name} ${row.amountText}`)
    : Array.isArray(data?.recipeIngredient)
      ? data.recipeIngredient.filter((v): v is string => typeof v === "string")
      : [...root.querySelectorAll(".ings tr")]
          .map((row) =>
            `${row.querySelector(".name")?.textContent?.trim() ?? ""} ${row.querySelector(".unit")?.textContent?.trim() ?? ""}`.trim(),
          )
          .filter(Boolean);
  const steps = sourceSteps(root, data);
  if (!name || !steps.length)
    throw new Error(
      "未找到菜谱正文，请选择菜谱页面保存的 HTML，或使用 JSON / 手动创建",
    );
  const ingredients: RecipeDraft["ingredients"] = [];
  const textIngredients: NonNullable<RecipeDraft["textIngredients"]> = [];
  for (const line of raw) {
    const reversed = line
      .trim()
      .match(
        /^(\d+(?:\.\d+)?)\s*(千克|公斤|kg|克|g|毫升|ml|升|L|斤|个|片|盒)\s*(.+)$/i,
      );
    const match = reversed
      ? [reversed[0], reversed[3], reversed[1], reversed[2]]
      : line
          .trim()
          .match(
            /^(.+?)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(千克|公斤|kg|克|g|毫升|ml|升|L|斤|个|片|盒)$/i,
          );
    if (!match) {
      const prefix = line
        .trim()
        .match(
          /^((?:\d+(?:\.\d+)?|半|一|二|三|四|五|六|七|八|九|十)?(?:小勺|大勺|汤匙|茶匙|勺|杯)|适量|少许)\s*(.+)$/,
        );
      const suffix = line
        .trim()
        .match(/^(.+?)\s+(适量|少许|.+(?:小勺|大勺|汤匙|茶匙|勺|杯))$/);
      textIngredients.push(
        prefix
          ? { name: prefix[2], amountText: prefix[1] }
          : suffix
            ? { name: suffix[1], amountText: suffix[2] }
            : { name: line, amountText: "用量待核对" },
      );
      continue;
    }
    const unit = match[3].toLowerCase();
    const multiplier = ["千克", "公斤", "kg", "升", "l"].includes(unit)
      ? 1000
      : unit === "斤"
        ? 500
        : 1;
    ingredients.push({
      name: match[1].replace(/[:：]\s*$/, "").trim(),
      quantity: Number(match[2]) * multiplier,
      unit: ["千克", "公斤", "kg", "克", "g", "斤"].includes(unit)
        ? "g"
        : ["毫升", "ml", "升", "l"].includes(unit)
          ? "ml"
          : unit,
    });
  }
  if (tableRows.length) {
    const parsed = splitIngredientRows(tableRows);
    ingredients.splice(0, ingredients.length, ...parsed.ingredients);
    textIngredients.splice(
      0,
      textIngredients.length,
      ...parsed.textIngredients,
    );
  }
  const warnings: string[] = [];
  if (textIngredients.length)
    warnings.push("部分食材保留原文用量，可在下方编辑。");
  const duration =
    typeof data?.totalTime === "string"
      ? data.totalTime.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i)
      : null;
  const minutes = duration
    ? Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0)
    : 0;
  const yieldText = String(data?.recipeYield ?? "");
  const yieldMatch = yieldText.match(/^\s*(\d+)\s*(?:人份?|份)?\s*$/);
  const servings = yieldMatch ? Number(yieldMatch[1]) : 0;
  if (!minutes || minutes > 1440)
    warnings.push("未识别用时，暂填 20 分钟，请按需修改。");
  if (!servings || servings > 12)
    warnings.push("未识别人数，暂填 2 人份，请按需修改。");
  return {
    warnings,
    draft: {
      name: name.trim(),
      category: "未分类",
      minutes: minutes > 0 && minutes <= 1440 ? minutes : 20,
      servings: servings > 0 && servings <= 12 ? servings : 2,
      subtitle:
        typeof data?.description === "string"
          ? data.description
          : text(".desc"),
      seasoning: "",
      textIngredients,
      ingredients,
      steps: steps.map((s) => s.body),
      stepTitles: steps.map((s) => s.title),
      source: { url, author, ingredientText: raw },
    },
  };
}

function imageUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(imageUrl).find(Boolean);
  if (object(value)) return imageUrl(value.url ?? value.contentUrl);
}

function imgUrl(img: Element) {
  return ["data-src", "data-original", "data-lazy-src", "src", "srcset"]
    .map((attr) => img.getAttribute(attr)?.trim().split(/[ ,]/)[0])
    .find((url) => url && !url.startsWith("data:"));
}

function sourceSteps(root: DocumentFragment, data?: Node): SourceStep[] {
  const structured = instructions(data?.recipeInstructions).filter(
    (step) => step.body,
  );
  const visible = [...root.querySelectorAll(".steps li")].filter(
    (step) => !step.parentElement?.closest(".steps li"),
  );
  const rows = visible.map((step, index) => {
    const counterpart =
      structured.length === visible.length ? structured[index] : undefined;
    const textNodes = step.querySelectorAll(".text, [itemprop=text]");
    const body = [
      ...(textNodes.length ? textNodes : step.querySelectorAll("p")),
    ]
      .filter((node) => !node.parentElement?.closest(".text, [itemprop=text]"))
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .join("\n");
    const image =
      [...step.querySelectorAll("img")].map(imgUrl).find(Boolean) ??
      counterpart?.image;
    return {
      title: counterpart?.title ?? "",
      body: body || counterpart?.body || (image ? "见步骤图" : ""),
      image,
    };
  });
  return (
    rows.some((row) => row.body && row.body !== "见步骤图") ||
    structured.length < rows.length
      ? rows
      : structured
  ).filter((step) => step.body);
}

function recipeImageSources(
  root: DocumentFragment,
  data: Node | undefined,
  rows: SourceStep[],
) {
  const cover =
    imageUrl(data?.image) ??
    [...root.querySelectorAll(".recipe-cover img")].map(imgUrl).find(Boolean);
  const steps = rows.flatMap(({ image }, index) =>
    image ? [{ url: image, sourceStep: index + 1 }] : [],
  );
  return { cover, steps };
}

export function recipeTextFromHtml(html: string): string {
  if (new TextEncoder().encode(html).length > 2_000_000)
    throw new Error("HTML 文件需小于 2 MB");
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const structured = [
    ...root.querySelectorAll('script[type="application/ld+json"]'),
  ].map((v) => v.textContent ?? "");
  const data = structured.flatMap((raw) => {
    try {
      return recipes(JSON.parse(raw));
    } catch {
      return [];
    }
  })[0];
  const rows = sourceSteps(root, data);
  const imageSources = recipeImageSources(root, data, rows);
  root
    .querySelectorAll("script,style,nav,header,footer,iframe,noscript")
    .forEach((v) => v.remove());
  const content = JSON.stringify({
    structured,
    imageSources,
    sourceSteps: rows.map(({ title, body }) => ({ title, body })),
    ingredientRows: [...root.querySelectorAll(".ings tr")]
      .map((row) => ({
        name: row.querySelector(".name")?.textContent?.trim() ?? "",
        amountText:
          row.querySelector(".unit")?.textContent?.trim() || "未注明用量",
      }))
      .filter((row) => row.name),
    body: (root.querySelector(".recipe") ?? root).textContent?.trim() ?? "",
  });
  if (content.length > 60000)
    throw new Error("页面正文过长，请粘贴菜谱正文后整理");
  return content;
}
