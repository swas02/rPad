// Black-box tests for src/themes.js. Written from its public surface only
// (window.THEMES, themeColors, applyPalette, paletteHex, accentHex, bootDone),
// not from its source. The file is a browser script, so it runs in a vm sandbox.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function load() {
  const store = {};
  const styles = {};
  const el = () => new Proxy(function () {}, {
    get: (t, k) => k === "style" ? { setProperty: (n, v) => { styles[n] = v; }, removeProperty() {}, getPropertyValue: n => styles[n] || "" }
      : k === "classList" ? { add() {}, remove() {}, toggle() {}, contains: () => false }
      : k === "dataset" ? {} : k === "getAttribute" ? () => null
      : k === "querySelectorAll" ? () => [] : () => el(),
    set: () => true, apply: () => el(),
  });
  const win = {
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    addEventListener() {}, TauriAPI: null,
  };
  const doc = { documentElement: el(), head: el(), body: el(), getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], createElement: () => el(), addEventListener() {}, readyState: "complete" };
  win.document = doc;
  const timers = [];
  const ctx = vm.createContext({ window: win, document: doc, localStorage: win.localStorage, matchMedia: win.matchMedia, getComputedStyle: () => ({ getPropertyValue: () => "" }), navigator: { userAgent: "node" }, console, setTimeout: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(new URL("../src/themes.js", import.meta.url), "utf8"), ctx);
  return { win, ctx, styles, store, timers };
}

const idsOf = T => Array.isArray(T) ? T.map(t => t.id ?? t.name) : Object.keys(T);

describe("themes.js", () => {
  const { win, timers } = load();

  test("loads without throwing and exposes the public API", () => {
    for (const k of ["THEMES", "themeColors", "applyPalette", "paletteHex", "accentHex", "bootDone"])
      assert.ok(win[k] !== undefined, `window.${k} missing`);
    for (const k of ["applyPalette", "paletteHex", "accentHex", "bootDone"]) assert.equal(typeof win[k], "function", k);
  });

  test("THEMES is a non-empty collection with unique ids", () => {
    const ids = idsOf(win.THEMES);
    assert.ok(ids.length >= 2, "the app offers a choice of at least two colour themes");
    assert.equal(new Set(ids).size, ids.length);
  });

  test("paletteHex / accentHex return #rrggbb strings for every theme", () => {
    const re = /^#[0-9a-f]{6}$/i;
    for (const id of idsOf(win.THEMES)) for (const k of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      assert.match(String(win.paletteHex(id, k)), re, `paletteHex(${id},${k})`);
      assert.match(String(win.accentHex(id, k)), re, `accentHex(${id},${k})`);
    }
  });

  test("a palette runs from light to dark (50 brighter than 900)", () => {
    const lum = h => { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114; };
    for (const id of idsOf(win.THEMES)) assert.ok(lum(win.paletteHex(id, 50)) > lum(win.paletteHex(id, 900)), id);
  });

  test("applyPalette with an unknown, empty or missing id does not throw", () => {
    assert.doesNotThrow(() => win.applyPalette("no-such-palette-xyz"));
    assert.doesNotThrow(() => win.applyPalette(undefined));
    assert.doesNotThrow(() => win.applyPalette(""));
  });

  test("applyPalette with each known id does not throw", () => {
    for (const id of idsOf(win.THEMES)) assert.doesNotThrow(() => win.applyPalette(id), id);
  });

  test("bootDone can be called twice safely", () => {
    assert.doesNotThrow(() => { win.bootDone(); win.bootDone(); });
  });

  test("a 3 s fallback timer is armed so the window never stays hidden", () => {
    assert.ok(timers.some(([, ms]) => ms === 3000), "no 3000 ms timer");
  });

  test("bootDone reveals the desktop window when TauriAPI exists", () => {
    const { win: w } = load();
    let n = 0; w.TauriAPI = { reveal: () => { n++; } };
    w.bootDone();
    assert.ok(n >= 1);
  });
});
