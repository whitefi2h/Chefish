import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import {
  lookupIngredient,
  searchEntries,
  normalizeName,
  eligibleCandidates,
  resolveIngredientAvatar,
} from "./lookup.mjs";

const root = fileURLToPath(
  new URL("../../resources/ingredient-icons/", import.meta.url),
);
const catalog = JSON.parse(await readFile(resolve(root, "index.json"), "utf8"));
const mode = process.argv[2] ?? "build";
if (mode === "fetch") {
  // Custom-license originals stay in the ignored local cache, outside the public asset pack.
  for (const asset of catalog.assets.filter((a) =>
    a.file.startsWith("local/"),
  )) {
    const path = resolve(root, asset.file);
    try {
      await readFile(path);
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const response = await fetch(asset.downloadUrl, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${asset.id}: HTTP ${response.status}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
    console.log(`Cached ${asset.id}`);
  }
} else if (mode === "query") {
  const name = process.argv.slice(3).join(" ");
  const result = lookupIngredient(catalog, name);
  console.log(
    JSON.stringify(
      {
        ...result,
        avatar: resolveIngredientAvatar(catalog, name, {
          existingIconId: result.iconId,
        }),
      },
      null,
      2,
    ),
  );
} else if (mode === "search") {
  console.log(
    JSON.stringify(
      searchEntries(catalog, process.argv.slice(3).join(" ")).map((e) => ({
        id: e.id,
        name: e.name,
        aliases: e.aliases,
        matchKind: e.matchKind,
        candidates: eligibleCandidates(catalog, e),
        notes: e.notes,
      })),
      null,
      2,
    ),
  );
} else if (mode === "build" || mode === "check") {
  const unique = (values, label) => {
    if (new Set(values).size !== values.length)
      throw new Error(`Duplicate ${label}`);
  };
  unique(
    catalog.entries.map((e) => e.id),
    "entry ID",
  );
  unique(
    catalog.assets.map((a) => a.id),
    "asset ID",
  );
  const owners = new Map();
  for (const entry of catalog.entries) {
    if (!entry.avatarText || Array.from(entry.avatarText).length > 2)
      throw new Error(`Missing short avatar label: ${entry.id}`);
    for (const name of [entry.name, ...entry.aliases]) {
      const normalized = normalizeName(name);
      if (owners.has(normalized) && owners.get(normalized) !== entry.id)
        throw new Error(`Conflicting alias: ${name}`);
      owners.set(normalized, entry.id);
    }
    for (const c of entry.candidates) {
      if (!catalog.assets.some((a) => a.id === c.iconId))
        throw new Error(`Missing candidate ${c.iconId}`);
    }
    if (
      entry.defaultIcon &&
      !eligibleCandidates(catalog, entry).some(
        (c) => c.iconId === entry.defaultIcon,
      )
    )
      throw new Error(`Default icon is not selectable: ${entry.id}`);
    if ((entry.matchKind === "pending") !== (entry.defaultIcon === null))
      throw new Error(`Pending state mismatch: ${entry.id}`);
  }
  const images = {};
  const safeFile = (path) => {
    const absolute = resolve(root, path),
      rel = relative(root, absolute);
    if (rel.startsWith("..") || isAbsolute(rel))
      throw new Error(`Path outside catalog: ${path}`);
    return absolute;
  };
  const research = JSON.parse(
    await readFile(resolve(root, "source-research.json"), "utf8"),
  );
  for (const asset of catalog.assets) {
    const bytes = await readFile(safeFile(asset.file));
    if (asset.format === "png") {
      images[asset.id] = `data:image/png;base64,${bytes.toString("base64")}`;
      continue;
    }
    const svg = bytes.toString("utf8");
    if (
      !svg.includes("<svg") ||
      /<script\b|<foreignObject\b|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?!#)/i.test(
        svg,
      )
    )
      throw new Error(`Non-static SVG: ${asset.id}`);
    images[asset.id] =
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }
  const licenses = {};
  for (const library of catalog.libraries) {
    licenses[library.id] = await readFile(
      safeFile(library.licenseFile),
      "utf8",
    );
    if (library.copyrightFile)
      licenses[library.id] +=
        "\n\nUpstream copyright notice (graphics remain CC BY 4.0):\n" +
        (await readFile(safeFile(library.copyrightFile), "utf8"));
  }
  if (mode === "build") {
    const template = await readFile(
      new URL("./review.template.html", import.meta.url),
      "utf8",
    );
    const functions = (
      await readFile(new URL("./lookup.mjs", import.meta.url), "utf8")
    ).replace(/^export /gm, "");
    const payload = JSON.stringify({
      catalog,
      images,
      licenses,
      research,
    }).replaceAll("<", "\\u003c");
    const html = template
      .replace("/* LOOKUP_FUNCTIONS */", () => functions)
      .replace(
        "/* CATALOG_PAYLOAD */",
        () => `const {catalog,images,licenses,research}=${payload};`,
      );
    const output = new URL(
      "../../docs/ingredient-icon-review.html",
      import.meta.url,
    );
    await mkdir(dirname(fileURLToPath(output)), { recursive: true });
    await writeFile(output, html);
    console.log(`Offline review: ${fileURLToPath(output)}`);
  }
  console.log(
    `Validated ${catalog.entries.length} ingredients / ${catalog.assets.length} color assets / ${catalog.libraries.length} source libraries`,
  );
} else {
  throw new Error("Use fetch, build, check, query <name>, or search <keyword>");
}
