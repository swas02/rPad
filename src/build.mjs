// Bundles src/editor.js and CodeMirror into editor.js (global `Editor`). Run: npm run build  (npm run watch while editing)
import { build, context } from "esbuild";

const opts = { entryPoints: ["src/editor.js"], outfile: "editor.js", bundle: true, minify: true, format: "iife", globalName: "Editor", target: "es2020", legalComments: "none", logLevel: "info" };
if (process.argv.includes("--watch")) await (await context(opts)).watch(); else await build(opts);
