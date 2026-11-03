// Plain-text operations used by the editor: list continuation, line formatting, Unicode styles, clean-up.
// Pure functions on strings, no DOM and no CodeMirror, so `npm test` can run them under Node.

// ---- lists: [ ] checkbox, • bullet, - dash, > quote, 1. numbers, a. letters, i. roman numerals
export const LRE = /^([ \t]*)(\[[ xX]\] |[•◦▪] |- |> |\d+\. |[ivxlcdm]+\. |[a-z]\. )/;
const ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
const RV = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
const isRoman = s => s.length > 0 && ROMAN.test(s);
const fromRoman = s => { let n = 0; for (let i = 0; i < s.length; i++) { const a = RV[s[i]], b = RV[s[i + 1]] || 0; n += a < b ? -a : a } return n };
const toRoman = n => { let r = ""; for (const [v, s] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]]) while (n >= v) { r += s; n -= v } return r };

// the marker of a line, or null (a word like "mid. " that only looks like a roman marker is not one)
export const markOf = l => { const m = l.match(LRE); if (!m) return null; const w = m[2].slice(0, -2); if (/^[a-z]+$/.test(w) && w.length > 1 && !isRoman(w)) return null; return m };

// marker of the previous line at the same indent (same list), or null. getLine(n) is the text of line n, lines count from 1.
function prevMark(getLine, n, indent) {
  for (let j = n - 1; j >= 1; j--) {
    const l = getLine(j); if (!l.trim()) return null;
    const d = l.match(/^[ \t]*/)[0].length; if (d < indent) return null;
    if (d === indent) { const m = markOf(l); return m ? m[2] : null }
  } return null
}

// text of the marker for the next item, or null when the list can't continue
function nextMark(getLine, n, m) {
  const t = m[2];
  if (t[0] === "[") return "[ ] ";
  if ("•◦▪-> ".includes(t[0]) && !/^\d/.test(t)) return t;
  if (/^\d/.test(t)) return (parseInt(t) + 1) + ". ";
  const w = t.slice(0, -2); let roman = w.length > 1;
  if (w.length === 1 && isRoman(w)) {
    const p = prevMark(getLine, n, m[1].length), pw = p && /^[a-z]+\. $/.test(p) ? p.slice(0, -2) : null;
    roman = pw ? isRoman(pw) && fromRoman(pw) + 1 === fromRoman(w) : w === "i";
  }
  if (roman) return toRoman(fromRoman(w) + 1) + ". ";
  return w === "z" ? null : String.fromCharCode(w.charCodeAt(0) + 1) + ". ";
}

// Enter pressed on line n, with `before` the text left of the caret and `rest` the text right of it.
//   { cut: true }    an empty list item: remove its marker
//   { insert: "\n…" } start the next item
//   null             not a list line: the editor's normal newline applies
export function continueList(before, rest, getLine, n) {
  const m = markOf(before);
  if (!m || before.length < m[0].length) return null;
  if (!before.slice(m[0].length).trim() && !rest.trim()) return { cut: true };
  const nx = nextMark(getLine, n, m), pre = m[1] + (nx || "");
  return pre ? { insert: "\n" + pre } : null
}

// ---- line formatting. Each takes the selected lines and returns the new lines.
// nested bullets: the marker depends on the indent (• ◦ ▪)
const BM = ["•", "◦", "▪"], mark = i => BM[Math.min(2, i.length >> 1)], fixB = l => l.replace(/^(\s*)[•◦▪] /, (m, i) => i + mark(i) + " ");
export const title = l => l.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase());
export const LINES = {
  in: L => L.map(l => fixB("  " + l)),
  out: L => L.map(l => fixB(l.replace(/^ {1,2}/, ""))),
  e: L => L.map(l => { const m = l.match(/^=== (.*) ===$/); return m ? m[1] : l.trim() ? "=== " + l.trim() + " ===" : l })
};

// quick-insert buttons: each tap types the text at the cursor (never removes anything)
export const INSERT = { c: "[ ] ", x: "[x] ", b: "• ", n: "1. ", d: "- ", q: "> ", h: "# ", v: "─".repeat(24) + "\n" };

// ---- text styles built from Unicode characters
const SET = { B: [0x1D5D4, 0x1D5EE, 0x1D7EC], I: [0x1D608, 0x1D622, 0], M: [0x1D670, 0x1D68A, 0x1D7F6] };
const sty = (t, k) => { const [U, W, D] = SET[k]; return Array.from(t).map(c => { const x = c.codePointAt(0); if (x >= 65 && x <= 90) return String.fromCodePoint(U + x - 65); if (x >= 97 && x <= 122) return String.fromCodePoint(W + x - 97); if (D && x >= 48 && x <= 57) return String.fromCodePoint(D + x - 48); return c }).join("") };
const unsty = t => Array.from(t).map(c => { const x = c.codePointAt(0); for (const [U, W, D] of Object.values(SET)) { if (x >= U && x < U + 26) return String.fromCharCode(65 + x - U); if (x >= W && x < W + 26) return String.fromCharCode(97 + x - W); if (D && x >= D && x < D + 10) return String.fromCharCode(48 + x - D) } return c }).join("");
const tog = k => t => { const base = unsty(t.normalize("NFC")).replace(/[̶̲]/g, ""), n = sty(base, k); return n === t ? base : n };
const mp = (t, f, to) => Array.from(t).map(c => { const i = f.indexOf(c); return i < 0 ? c : to[i] }).join("");
const SPF = "0123456789+-=()n", SPT = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ";
const SBF = "0123456789+-=()", SBT = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎";
// strike ~~text~~ and underline __text__ use plain markers: they show in every font and app
export const wrap = (t, m) => { t = t.replace(/[̶̲]/g, ""); return t.length > 2 * m.length && t.startsWith(m) && t.endsWith(m) ? t.slice(m.length, -m.length) : m + t + m };
const scr = (F, T) => t => Array.from(t).some(c => T.includes(c)) ? mp(t, T, F) : mp(t, F, T);
export const STYLES = {
  s: t => wrap(t, "~~"), ul: t => wrap(t, "__"),
  bo: tog("B"), it: tog("I"), mo: tog("M"), sp: scr(SPF, SPT), sb: scr(SBF, SBT)
};

// ---- clean up: [acts on whole lines, transform, message for the toast]
const lines = f => t => f(t.split("\n")).join("\n"), cmp = (x, y) => !x.trim() - !y.trim() || x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
export const CLEAN = {
  join: [1, lines(L => L.reduce((o, l) => { const p = o.length - 1; if (p >= 0 && o[p].trim() && l.trim() && !LRE.test(l)) o[p] = o[p].trimEnd() + " " + l.trim(); else o.push(l); return o }, [])), "Joined lines"],
  plain: [0, t => t.normalize("NFKC").replace(/[​-‍⁠﻿­̶̲]/g, "").replace(/[   ]/g, " ").replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"').replace(/[‐-―]/g, "-").replace(/\r\n?/g, "\n"), "Made plain"],
  trim: [1, lines(L => L.map(l => l.replace(/[ \t]+$/, "").replace(/(\S)[ \t]{2,}/g, "$1 "))), "Trimmed spaces"],
  blank: [1, lines(L => L.filter(l => l.trim())), "Removed blank lines"],
  sort: [1, lines(L => [...L].sort(cmp)), "Sorted lines"],
  dedupe: [1, lines(L => { const s = new Set(); return L.filter(l => { const k = l.trim(); if (!k) return true; if (s.has(k)) return false; s.add(k); return true }) }), "Removed duplicate lines"],
  lo: [0, t => t.toLowerCase(), "Changed to lower case"], up: [0, t => t.toUpperCase(), "Changed to upper case"], ti: [0, title, "Changed to Title Case"],
  se: [0, t => t.toLowerCase().replace(/(^|[.!?]\s+|\n\s*)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()), "Changed to sentence case"]
};
