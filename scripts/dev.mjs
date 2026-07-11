import { context } from "esbuild";
import { build as viteBuild } from "vite";

await viteBuild({ build: { watch: {} } });

const background = await context({
  entryPoints: ["src/background.ts"],
  outfile: "dist/assets/background.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  sourcemap: true
});

const content = await context({
  entryPoints: ["src/content.ts"],
  outfile: "dist/assets/content.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  sourcemap: true
});

await Promise.all([background.watch(), content.watch()]);
console.log("Watching extension sources. Reload the unpacked extension after each rebuild.");
await new Promise(() => {});
