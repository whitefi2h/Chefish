import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { eligibleCandidates, normalizeName } from "./lookup.mjs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export async function prepareIngredientAvatars() {
  const root = new URL("../../", import.meta.url);
  const source = new URL("resources/ingredient-icons/", root);
  const catalog = JSON.parse(
    await readFile(new URL("index.json", source), "utf8"),
  );
  const output = new URL("public/ingredient-icons/", root);
  await mkdir(output, { recursive: true });
  const assets = {};
  const used = new Set(
    catalog.entries.flatMap((e) =>
      eligibleCandidates(catalog, e).map((c) => c.iconId),
    ),
  );
  for (const asset of catalog.assets.filter((a) => used.has(a.id))) {
    const library = catalog.libraries.find((l) => l.id === asset.library);
    const filename = `${asset.id.replace(":", "-")}.${asset.format}`;
    await copyFile(new URL(asset.file, source), new URL(filename, output));
    assets[asset.id] = {
      url: `/ingredient-icons/${filename}`,
      author: library.author,
      license: library.license,
      sourceUrl: asset.sourceUrl,
      licenseUrl: library.licenseUrl,
    };
  }
  for (const library of catalog.libraries.filter((l) =>
    catalog.assets.some((a) => used.has(a.id) && a.library === l.id),
  )) {
    await copyFile(
      new URL(library.licenseFile, source),
      new URL(`${library.id}-LICENSE.txt`, output),
    );
    if (library.copyrightFile)
      await copyFile(
        new URL(library.copyrightFile, source),
        new URL(`${library.id}-COPYRIGHT.txt`, output),
      );
  }
  const entries = catalog.entries.map((e) => ({
    id: e.id,
    names: [e.name, ...e.aliases].map(normalizeName),
    label: e.avatarText,
    category: e.category,
    kind: e.matchKind,
    preferred: e.defaultIcon,
    candidates: eligibleCandidates(catalog, e).map((c) => c.iconId),
  }));
  await mkdir(new URL("src/generated/", root), { recursive: true });
  await writeFile(
    new URL("src/generated/ingredientAvatars.json", root),
    JSON.stringify({
      entries,
      assets,
      credits: catalog.libraries
        .filter((l) =>
          catalog.assets.some((a) => used.has(a.id) && a.library === l.id),
        )
        .map((l) => ({
          name: l.name,
          author: l.author,
          license: l.license,
          url: l.licenseUrl,
        })),
      ambiguousNames: catalog.policy.ambiguousNames.map(normalizeName),
      ...catalog.avatar,
    }),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await prepareIngredientAvatars();
}
