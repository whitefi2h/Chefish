import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const { version } = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const file = `Chefish_${version}_x64-setup.exe`;
const bundle = new URL("src-tauri/target/release/bundle/nsis/", root);
const signature = (
  await readFile(new URL(`${file}.sig`, bundle), "utf8")
).trim();
const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");
const notes =
  changelog
    .split(`## ${version} — `)[1]
    ?.split("\n")
    .slice(1)
    .join("\n")
    .split("\n## ")[0]
    .trim() ?? "";
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/whitefi2h/Chefish/releases/download/v${version}/${file}`,
    },
  },
};
const destination = new URL("latest.json", bundle);
await writeFile(destination, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Update manifest: ${fileURLToPath(destination)}`);
