// Project-integrity tests. They check the contract between files (what the
// service worker caches, what the page loads, what the manifest names)
// without looking at how any feature is built.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
// A leading BOM is allowed (browsers accept it in the manifest), so strip it before parsing.
const read = p => fs.readFileSync(path.join(root, p), "utf8").replace(/^﻿/, "");
const exists = p => fs.existsSync(path.join(root, p));

describe("package.json", () => {
  const pkg = JSON.parse(read("package.json"));
  test("has the scripts the project relies on", () => {
    for (const s of ["build", "test", "tauri"]) assert.ok(pkg.scripts[s], s);
  });
  test("is an ES module project", () => assert.equal(pkg.type, "module"));
  test("every script entry file exists", () => {
    for (const cmd of Object.values(pkg.scripts)) for (const m of cmd.matchAll(/node\s+(\S+\.m?js)/g)) assert.ok(exists(m[1]), m[1]);
  });
});

describe("manifest.webmanifest", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  test("has name, display and start_url", () => {
    assert.ok(m.name); assert.ok(m.display); assert.ok(m.start_url);
  });
  test("every icon file exists", () => {
    for (const i of m.icons || []) assert.ok(exists(i.src.replace(/^\.?\//, "")), i.src);
  });
  test("is linked from index.html", () => assert.match(read("index.html"), /manifest\.webmanifest/));
});

describe("service worker", () => {
  const sw = read("sw.js");
  const list = [...sw.matchAll(/"\.\/([^"]*)"/g)].map(m => m[1]).filter(Boolean);
  test("precaches at least the app page", () => assert.ok(list.includes("index.html")));
  test("every precached file exists", () => {
    for (const f of list) assert.ok(exists(f), `missing precache file: ${f}`);
  });
  test("has no duplicate precache entries", () => assert.equal(new Set(list).size, list.length));
  test("cache name is versioned", () => assert.match(sw, /notepad-v\d+/));
  test("registers install, activate and fetch handlers", () => {
    for (const ev of ["install", "activate", "fetch"]) assert.match(sw, new RegExp(`["']${ev}["']`), ev);
  });
});

describe("index.html", () => {
  const html = read("index.html");
  test("declares a doctype, charset and viewport", () => {
    assert.match(html, /^﻿?\s*<!doctype html>/i);
    assert.match(html, /charset/i);
    assert.match(html, /name=["']viewport["']/);
  });
  test("local script and stylesheet references exist", () => {
    for (const m of html.matchAll(/(?:src|href)=["'](?!https?:|data:|#|mailto:)([^"'?#]+)/g)) assert.ok(exists(m[1].replace(/^\.\//, "")), m[1]);
  });
  test("element ids are unique", () => {
    // Script blocks hold HTML templates that are shown one at a time, so only static markup is checked.
    const ids = [...html.replace(/<script[\s\S]*?<\/script>/gi, "").matchAll(/\sid=["']([^"']+)["']/g)].map(m => m[1]);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    assert.deepEqual([...new Set(dup)], []);
  });
  test("main block tags are balanced", () => {
    for (const t of ["div", "button", "section", "nav", "select"]) {
      const o = (html.match(new RegExp(`<${t}[\\s>]`, "g")) || []).length;
      const c = (html.match(new RegExp(`</${t}>`, "g")) || []).length;
      assert.equal(o, c, `<${t}> open ${o} close ${c}`);
    }
  });
});

describe("Tauri config", () => {
  test("tauri.conf.json is valid JSON with a product name", () => {
    assert.ok(exists("src-tauri/tauri.conf.json"), "tauri.conf.json missing");
    const c = JSON.parse(read("src-tauri/tauri.conf.json"));
    assert.ok(c.productName || c.package?.productName);
  });
  test("Cargo.toml names a package and version", () => {
    const t = read("src-tauri/Cargo.toml");
    assert.match(t, /^name\s*=/m); assert.match(t, /^version\s*=/m);
  });
});
