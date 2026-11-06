// Builds dist/ for the Tauri desktop app: same index.html, but fully offline and light.
// Tailwind is precompiled (no CDN JIT in the webview), fonts are bundled (latin only), no service worker.
// --watch: build once, then rebuild on changes to index.html, src/ or assets/ (used by `tauri dev`, which reloads the window).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";

const WATCH = process.argv.includes("--watch");

async function buildDist(clean) {
  if (clean) rmSync("dist", { recursive: true, force: true });
  mkdirSync("dist/fonts", { recursive: true });
  mkdirSync("dist/src", { recursive: true });

  await build({ entryPoints: ["src/editor.js"], outfile: "dist/editor.js", bundle: true, minify: true, format: "iife", globalName: "Editor", target: "es2020", legalComments: "none", logLevel: "warning" });
  await build({ entryPoints: ["src/tauri.js"], outfile: "dist/tauri.js", bundle: true, minify: true, format: "iife", globalName: "TauriAPI", target: "es2020", legalComments: "none", logLevel: "warning" });
  cpSync("src/themes.js", "dist/src/themes.js");
  cpSync("assets", "dist/assets", { recursive: true });

  const fonts = [["figtree", "figtree", [400, 500, 600]], ["spline-sans-mono", "spline-sans-mono", [400, 500]]];
  let faces = "";
  for (const [pkg, name, weights] of fonts) for (const w of weights) {
    const f = `${name}-latin-${w}-normal.woff2`;
    cpSync(`node_modules/@fontsource/${pkg}/files/${f}`, `dist/fonts/${f}`);
    faces += `@font-face{font-family:"${pkg === "figtree" ? "Figtree" : "Spline Sans Mono"}";font-weight:${w};font-display:swap;src:url(fonts/${f}) format("woff2")}\n`;
  }

  execFileSync(process.execPath, ["node_modules/tailwindcss/lib/cli.js", "-c", "tailwind.config.cjs", "-i", "src/tw.css", "-o", "dist/tw.css", "--minify"], { stdio: "inherit" });
  writeFileSync("dist/tw.css", faces + readFileSync("dist/tw.css", "utf8"));

  let html = readFileSync("index.html", "utf8");
  const strip = (re, what) => { const n = html.replace(re, ""); if (n === html) throw new Error("build-desktop: could not strip " + what); html = n };
  strip(/<link\s+href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/, "google fonts");
  strip(/<script src="https:\/\/cdn\.tailwindcss\.com[^>]*><\/script>\s*<script>\s*tailwind\.config[\s\S]*?<\/script>/, "tailwind cdn + config");
  strip(/<link rel="manifest"[^>]*>\s*/, "manifest");
  html = html.replace('<script src="src/themes.js"></script>', '<link rel="stylesheet" href="tw.css">\n  <script src="src/themes.js"></script>');
  html = html.replace(/if \("serviceWorker" in navigator[^\n]*\n/, "");
  html = html.replace('<script src="editor.js"></script>', '<script src="tauri.js"></script>\n  <script src="editor.js"></script>');
  // The CSP has no 'unsafe-inline' for scripts, so the page's inline script moves to its own file.
  const inl = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (inl.length !== 1) throw new Error(`build-desktop: expected 1 inline script, found ${inl.length}`);
  writeFileSync("dist/app.js", inl[0][1]);
  html = html.replace(inl[0][0], () => '<script src="app.js"></script>');
  writeFileSync("dist/index.html", html);
  console.log("dist/ ready");
}

// In watch mode don't wipe dist/ first: the dev server is serving it.
await buildDist(!WATCH);

if (WATCH) {
  let t = 0, busy = false, again = false;
  const run = async () => {
    if (busy) { again = true; return }
    busy = true;
    try { await buildDist(false) } catch (e) { console.error(e.message) }
    busy = false;
    if (again) { again = false; run() }
  };
  const kick = () => { clearTimeout(t); t = setTimeout(run, 150) };
  watch("index.html", kick);
  watch("src", { recursive: true }, kick);
  watch("assets", { recursive: true }, kick);
  console.log("watching index.html, src/, assets/ …");
}
