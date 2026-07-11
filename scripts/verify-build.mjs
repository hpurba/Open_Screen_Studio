import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));

const required = new Set([
  manifest.background?.service_worker,
  manifest.action?.default_icon?.["16"],
  manifest.action?.default_icon?.["32"],
  manifest.action?.default_icon?.["48"],
  manifest.action?.default_icon?.["128"],
  manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? [])
]);

for (const relativePath of required) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("The production manifest contains an empty required path.");
  }
  await access(join(root.pathname, relativePath));
}

await access(new URL("offscreen.html", root));
await access(new URL("THIRD_PARTY_NOTICES.md", root));
const assetNames = await readdir(new URL("assets/", root));
if (!assetNames.some((name) => name.endsWith(".wasm"))) {
  throw new Error("The production extension is missing its local MP4 encoder.");
}
console.log(`Verified ${required.size + 2} production extension files.`);
