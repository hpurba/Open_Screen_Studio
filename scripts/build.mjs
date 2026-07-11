import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

await viteBuild();

await Promise.all([
  esbuild({
    entryPoints: ["src/background.ts"],
    outfile: "dist/assets/background.js",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome116",
    sourcemap: true,
    minify: true
  }),
  esbuild({
    entryPoints: ["src/content.ts"],
    outfile: "dist/assets/content.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome116",
    sourcemap: true,
    minify: true
  })
]);
