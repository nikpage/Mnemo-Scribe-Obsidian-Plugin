import esbuild from "esbuild";
import { appBuild } from "./app-build.mjs";

// Obsidian loads one file. Everything the plugin uses is bundled into it
// except Obsidian's own API, which the app provides at runtime.
const production = process.argv.includes("production");

const context = await esbuild.context({
  ...appBuild,
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  outfile: "main.js",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
