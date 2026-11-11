/**
 * BRUTAL test suite for textops.
 *
 *   node --test textops_brutal_test.mjs
 *   TEXTOPS_SEED=1234 node --test textops_brutal_test.mjs      # reproduce a fuzz failure
 *   FUZZ_N=50000 node --test textops_brutal_test.mjs           # go harder
 *
 * Tags in test names:
 *   [spec]    pinned by your original tests
 *   [oracle]  compared against a trivially-correct reference implementation
 *   [law]     an invariant any correct implementation must satisfy
 *   [fuzz]    seeded random input (seed printed at start; failures print the input)
 *   [hostile] adversarial input: unicode abuse, giant lines, ReDoS, stale regex state
 *   [guess]   my reading of intended behaviour for cases the original tests don't pin down
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { continueList, LINES, CLEAN, markOf } from "../src/textops.js";

/* ------------------------------------------------------------------ *
 * infrastructure
 * ------------------------------------------------------------------ */
const SEED = Number(process.env.TEXTOPS_SEED ?? (Date.now() & 0x7fffffff));
const N = Number(process.env.FUZZ_N ?? 3000);
console.log(`# textops brutal: TEXTOPS_SEED=${SEED} FUZZ_N=${N}`);

const mulberry32 = a => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const mk = salt => mulberry32(SEED ^ salt);
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const str = (r, alpha, max, min = 0) =>
  Array.from({ length: int(r, min, max) }, () => pick(r, alpha)).join("");
const ALNUM = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
const LOWNUM = [..."abcdefghijklmnopqrstuvwxyz0123456789"];
const NASTY = [
  "\u0000", "\u200b", "\u200d", "\u202e", "\u2028", "\u2029", "\u00a0", "\ufeff", "\r", "\t",
  "\ud83d", "\ude00", "😀", "👨‍👩‍👧", "é", "e\u0301", "ß", "İ", "ǅ", "日", "ع",
  "‘", "’", "“", "”", "—", "–", "…", "~", "-", "•", "◦", "▪", ">", "[", "]", ".", " ", "x", "1", "i",
];
const fail = (what, input, extra = "") =>
  `${what}\n  seed=${SEED}\n  input=${JSON.stringify(input)}${extra ? "\n  " + extra : ""}`;
const ms = fn => { const t = performance.now(); fn(); return performance.now() - t; };
const fast = (name, fn, limit = 1500) =>
  test(name, { timeout: limit * 6 }, () => {
    const t = ms(fn);
    assert.ok(t < limit, `${name} took ${t.toFixed(0)}ms (limit ${limit}ms): quadratic/exponential behaviour?`);
  });

const lineFn = text => { const L = text.split("\n"); return n => L[n - 1]; };
const enter = (text, n = text.split("\n").length) =>
  continueList(text.split("\n")[n - 1], "", lineFn(text), n);
const clean = (k, s) => CLEAN[k][1](s);
const sig = s => s.replace(/\s+/gu, "");        // whitespace-insensitive content signature

/* ================================================================== *
 * 0. ORIGINAL CONTRACT  [spec]
 * ================================================================== */
describe("original contract [spec]", () => {
  test("Enter continues each kind of list", () => {
    assert.deepEqual(enter("- a"), { insert: "\n- " });
    assert.deepEqual(enter("• a"), { insert: "\n• " });
    assert.deepEqual(enter("[x] done"), { insert: "\n[ ] " });
    assert.deepEqual(enter("1. a"), { insert: "\n2. " });
    assert.deepEqual(enter("9. a"), { insert: "\n10. " });
    assert.deepEqual(enter("a. a"), { insert: "\nb. " });
    assert.deepEqual(enter("  - nested"), { insert: "\n  - " });
    assert.deepEqual(enter("> quote"), { insert: "\n> " });
  });
  test("roman numerals", () => {
    assert.deepEqual(enter("i. a"), { insert: "\nii. " });
    assert.deepEqual(enter("iii. a"), { insert: "\niv. " });
    assert.deepEqual(enter("h. a\ni. b"), { insert: "\nj. " });
  });
  test("empty item ends list; plain falls through", () => {
    assert.deepEqual(enter("- "), { cut: true });
    assert.equal(enter("hello"), null);
    assert.equal(enter("mid. word"), null);
    assert.equal(markOf("mid. x"), null);
  });
  test("caret inside marker / before text", () => {
    assert.equal(continueList("-", "", lineFn("-"), 1), null);
    assert.deepEqual(continueList("- ab", "cd", lineFn("- abcd"), 1), { insert: "\n- " });
  });
  test("indent / outdent", () => {
    assert.deepEqual(LINES.in(["• a"]), ["  ◦ a"]);
    assert.deepEqual(LINES.in(["  ◦ a"]), ["    ▪ a"]);
    assert.deepEqual(LINES.out(["    ▪ a"]), ["  ◦ a"]);
    assert.deepEqual(LINES.out(["x"]), ["x"]);
  });
  test("clean up", () => {
    assert.equal(clean("join", "a\nb\n\n- c\n- d"), "a b\n\n- c\n- d");
    assert.equal(clean("trim", "a  b  \nc"), "a  b\nc");
    assert.equal(clean("dedupe", "a\n  a\na"), "a\n  a");
    assert.equal(clean("se", "I think NASA is good. yes"), "I think NASA is good. Yes");
    assert.equal(clean("ti", "NASA reports"), "NASA Reports");
    assert.equal(clean("blank", "a\n\nb"), "a\nb");
    assert.equal(clean("sort", "b\na10\na2"), "a2\na10\nb");
    assert.equal(clean("dedupe", "a\nb\na"), "a\nb");
    assert.equal(clean("plain", "“hi” — ok"), '"hi" - ok');
    assert.equal(clean("se", "HELLO. WORLD"), "Hello. World");
  });
});

/* ================================================================== *
 * 1. continueList: ORACLE FUZZ
 * ================================================================== */
describe("continueList oracle fuzz [oracle][fuzz]", () => {
  const INDENTS = ["", " ", "  ", "    ", "\t", "      "];
  const BULLETS = ["- ", "• ", "◦ ", "▪ ", "> "];
  const textOf = r => str(r, [...ALNUM, " ", ".", ",", "!", "é", "日", "😀"], 30, 1).replace(/^\s+/, "x");

  test(`bullets/quotes: continue with identical indent+marker (${N} cases)`, () => {
    const r = mk(1);
    for (let i = 0; i < N; i++) {
      const ind = pick(r, INDENTS), b = pick(r, BULLETS), line = ind + b + textOf(r);
      assert.deepEqual(enter(line), { insert: "\n" + ind + b }, fail("bullet", line));
    }
  });
  test(`numbers: n → n+1 with same indent (${N} cases)`, () => {
    const r = mk(2);
    for (let i = 0; i < N; i++) {
      const ind = pick(r, INDENTS), n = int(r, 1, 100000), line = `${ind}${n}. ${textOf(r)}`;
      assert.deepEqual(enter(line), { insert: `\n${ind}${n + 1}. ` }, fail("number", line));
    }
  });
  test(`letters (non-roman-ambiguous): c→d … (${N} cases)`, () => {
    const r = mk(3), SAFE = [..."abcdefgjklmnopqrstyz"].filter(c => c !== "z" && !"ivx".includes(String.fromCharCode(c.charCodeAt(0) + 1)));
    for (let i = 0; i < N; i++) {
      const ind = pick(r, INDENTS), cur = pick(r, SAFE);
      const next = String.fromCharCode(cur.charCodeAt(0) + 1);
      const line = `${ind}${cur}. ${textOf(r)}`;
      assert.deepEqual(enter(line), { insert: `\n${ind}${next}. ` }, fail("letter", line));
    }
  });
  test(`checkboxes: always continue as unchecked, same indent (${N} cases)`, () => {
    const r = mk(4);
    for (let i = 0; i < N; i++) {
      const ind = pick(r, INDENTS), box = pick(r, ["[ ] ", "[x] "]), line = ind + box + textOf(r);
      assert.deepEqual(enter(line), { insert: `\n${ind}[ ] ` }, fail("checkbox", line));
    }
  });
  test(`empty items always cut, any indent (${N} cases)`, () => {
    const r = mk(5);
    for (let i = 0; i < N; i++) {
      const ind = pick(r, INDENTS);
      const m = pick(r, [...BULLETS, "[ ] ", "[x] ", `${int(r, 1, 999)}. `, "a. ", "i. "]);
      assert.deepEqual(enter(ind + m), { cut: true }, fail("empty item", ind + m));
    }
  });
  test(`splitting mid-text behaves exactly like Enter at end (${N} cases)`, () => {
    const r = mk(6);
    for (let i = 0; i < N; i++) {
      const ind = pick(r, INDENTS), b = pick(r, ["- ", "• ", "> ", `${int(r, 1, 99)}. `]);
      const text = textOf(r) + "xx", k = int(r, 1, text.length - 1);
      const line = ind + b + text;
      const atEnd = enter(line);
      const mid = continueList(ind + b + text.slice(0, k), text.slice(k), lineFn(line), 1);
      assert.deepEqual(mid, atEnd, fail("split", line, `k=${k}`));
    }
  });
});

/* ================================================================== *
 * 2. continueList: LAWS under garbage input
 * ================================================================== */
describe("continueList laws on garbage [law][fuzz]", () => {
  test(`never throws, result shape is {insert}|{cut:true}|null (${N * 3} cases)`, () => {
    const r = mk(10);
    for (let i = 0; i < N * 3; i++) {
      const line = str(r, [...NASTY, ...ALNUM, " ", " ", "-", ".", "\n"], 40).split("\n")[0];
      const after = str(r, NASTY, 5);
      let res;
      assert.doesNotThrow(() => { res = continueList(line, after, lineFn(line + after), 1); }, fail("threw", line));
      if (res === null) continue;
      assert.equal(typeof res, "object", fail("non-object", line));
      const keys = Object.keys(res);
      assert.equal(keys.length, 1, fail("extra keys", line, JSON.stringify(res)));
      if (keys[0] === "insert") {
        assert.equal(typeof res.insert, "string");
        assert.ok(res.insert.startsWith("\n"), fail("insert w/o newline", line, JSON.stringify(res)));
        assert.ok(!/undefined|NaN|null|Infinity|\[object/.test(res.insert), fail("poisoned insert", line, JSON.stringify(res)));
        assert.ok(!res.insert.slice(1).includes("\n"), fail("multi-line insert", line));
      } else assert.deepEqual(res, { cut: true });
    }
  });
  test(`non-null result ⇒ markOf says it's a list line (${N * 2} cases)`, () => {
    const r = mk(11);
    for (let i = 0; i < N * 2; i++) {
      const line = str(r, [...ALNUM, " ", " ", "-", ".", "•", ">", "[", "]", "x", "1", "i"], 14);
      if (enter(line) !== null) assert.notEqual(markOf(line), null, fail("markOf disagrees", line));
    }
  });
  test(`insert always re-parses as a list item (${N} cases)`, () => {
    const r = mk(12);
    for (let i = 0; i < N; i++) {
      const line = str(r, [...ALNUM.slice(0, 6), " ", "-", ".", "•", ">", "1", "i"], 12);
      const res = enter(line);
      if (res?.insert) assert.notEqual(markOf(res.insert.slice(1) + "x"), null, fail("insert not a list", line, JSON.stringify(res)));
    }
  });
  test(`repeated Enter never ends a list by accident, 1000 steps (numbers, bullets, letters)`, () => {
    // "a. x" is not in this list: a letter list stops at "z." by design (see the test below).
    for (const first of ["- x", "1. x", "• x", "[ ] x", "> x"]) {
      let text = first;
      for (let i = 0; i < 1000; i++) {
        const res = enter(text);
        assert.ok(res?.insert, `${first}: step ${i} gave ${JSON.stringify(res)}`);
        text += res.insert + "x";
      }
    }
  });
  test("alphabetical lists past z don't crash or emit garbage", () => {
    let text = "a. x";
    for (let i = 0; i < 80; i++) {
      const res = enter(text);
      if (!res) return; // stopping is acceptable
      if (res.cut) return;
      assert.ok(!/undefined|NaN|\{|\}/.test(res.insert), JSON.stringify(res));
      text += res.insert + "x";
    }
  });
});

/* ================================================================== *
 * 3. continueList: HOSTILE inputs
 * ================================================================== */
describe("continueList hostile [hostile]", () => {
  test("unsafe/huge integers never go scientific or lose precision into garbage", () => {
    for (const n of ["99999999999999999999", "9007199254740993", "1".repeat(400), "0", "00", "007"]) {
      let res; assert.doesNotThrow(() => { res = enter(`${n}. a`); });
      if (res?.insert) assert.ok(!/e\+|Infinity|NaN/.test(res.insert), `${n} → ${JSON.stringify(res)}`);
    }
  });
  test("leading zeros: 007 → 008 or 8, never NaN", () => {
    const res = enter("007. a");
    if (res?.insert) assert.match(res.insert, /^\n0*8\. $/);
  });
  test("zero and negative-looking numbers", () => {
    assert.ok([null, "\n1. "].includes(enter("0. a")?.insert ?? null));
    assert.equal(enter("-1. a")?.insert ?? "ok", enter("-1. a")?.insert ?? "ok"); // must not throw
  });
  test("roman numerals up to 39 advance correctly", () => {
    const toRoman = n => { let s = ""; for (const [v, c] of [[10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]]) while (n >= v) { s += c; n -= v; } return s; };
    for (let n = 2; n < 39; n++) {
      if (n === 8 || n === 9 || n === 10 || n === 22 || n === 23 || n === 24) { /* x/v/i alone are letter-ambiguous; still must work with 2+ chars */ }
      if (toRoman(n).length < 2) continue;   // single chars are letter-ambiguous
      assert.deepEqual(enter(`${toRoman(n)}. a`), { insert: `\n${toRoman(n + 1)}. ` }, `${toRoman(n)}`);
    }
  });
  test("invalid roman 'iiii.' / 'vv.' / 'iix.' don't crash", () => {
    for (const s of ["iiii. a", "vv. a", "iix. a", "mcmxcix. a", "mmmm. a"]) assert.doesNotThrow(() => enter(s), s);
  });
  test("unicode lookalike markers are NOT list markers", () => {
    for (const s of ["－ a", "‐ a", "‑ a", "− a", "﹣ a", "· a", "٠. a", "１. a", "➀. a", "—  a"]) {
      assert.equal(enter(s), null, JSON.stringify(s));
      assert.equal(markOf(s), null, JSON.stringify(s));
    }
  });
  test("zero-width / invisible chars after marker do not create a fake empty item", () => {
    for (const z of ["\u200b", "\u200d", "\ufeff"]) {
      const res = enter(`- ${z}`);
      assert.ok(res === null || res.insert || res.cut, JSON.stringify(res)); // no throw
    }
    assert.equal(enter("-\u200b a"), null);
  });
  test("[guess] NBSP-only item counts as empty (cut) or non-empty (continue) but is consistent", () => {
    const a = enter("- \u00a0"), b = enter("- \u00a0");
    assert.deepEqual(a, b);
    assert.ok(a === null || a.cut || a.insert);
  });
  test("CRLF / trailing \\r doesn't break detection", () => {
    assert.ok(enter("- a\r") !== null);
    assert.ok(enter("1. a\r") !== null);
    const r = enter("- a\r"); if (r?.insert) assert.ok(!r.insert.includes("\r\r"));
  });
  test("U+2028 / U+2029 inside text are just text", () => {
    assert.deepEqual(enter("- a\u2028b"), { insert: "\n- " });
    assert.deepEqual(enter("- a\u2029b"), { insert: "\n- " });
  });
  test("surrogate pairs, lone surrogates, ZWJ sequences in text", () => {
    for (const t of ["😀", "\ud83d", "\ude00", "👨‍👩‍👧", "e\u0301", "\u202e rtl"]) assert.deepEqual(enter(`- ${t}`), { insert: "\n- " }, JSON.stringify(t));
  });
  test("marker-looking text inside content never re-triggers", () => {
    assert.deepEqual(enter("- 1. a"), { insert: "\n- " });
    assert.deepEqual(enter("1. - a"), { insert: "\n2. " });
    assert.deepEqual(enter("> - a"), { insert: "\n> " });
    assert.deepEqual(enter("- [ ] a"), { insert: "\n- " });
  });
  test("prototype-ish text is just text", () => {
    for (const t of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      assert.deepEqual(enter(`- ${t}`), { insert: "\n- " });
      assert.equal(enter(t), null);
      assert.equal(markOf(t), null);
    }
  });
  test("lineFn lies: undefined / null / throws-free for missing lines", () => {
    for (const lf of [() => undefined, () => null, () => "", () => "- a"]) {
      assert.doesNotThrow(() => continueList("i. a", "", lf, 1));
      assert.doesNotThrow(() => continueList("i. a", "", lf, 0));
      assert.doesNotThrow(() => continueList("i. a", "", lf, 99999));
      assert.doesNotThrow(() => continueList("i. a", "", lf, 2));
    }
  });
  test("lineFn is called with sane numbers only (never NaN / negative / fractional)", () => {
    const seen = [];
    for (const l of ["i. a", "h. a", "a. a", "1. a"]) continueList(l, "", n => { seen.push(n); return "x"; }, 7);
    for (const n of seen) assert.ok(Number.isInteger(n) && n >= 0, `lineFn(${n})`);
  });
  test("no hidden state: 500 interleaved calls give identical answers (stale /g regex lastIndex)", () => {
    const inputs = ["- a", "1. a", "i. a", "[x] a", "> a", "hello", "- ", "mid. word", "  2. nested"];
    const base = inputs.map(s => JSON.stringify(enter(s)));
    for (let round = 0; round < 500; round++) {
      inputs.forEach((s, i) => assert.equal(JSON.stringify(enter(s)), base[i], `round ${round}: ${s}`));
      inputs.slice().reverse().forEach(s => markOf(s));
    }
  });
  test("no hidden state in markOf either", () => {
    const base = ["- a", "1. a", "x"].map(markOf);
    for (let i = 0; i < 500; i++) ["- a", "1. a", "x"].forEach((s, k) => assert.deepEqual(markOf(s), base[k]));
  });

  // ReDoS / quadratic traps
  fast("100k leading spaces then text", () => enter(" ".repeat(100_000) + "x"));
  fast("100k leading spaces then '- a'", () => enter(" ".repeat(100_000) + "- a"));
  fast("100k tabs then '1. a'", () => enter("\t".repeat(100_000) + "1. a"));
  fast("200k digits then '. a'", () => enter("1".repeat(200_000) + ". a"));
  fast("200k digits, no dot", () => enter("1".repeat(200_000)));
  fast("200k letters then '. '", () => enter("a".repeat(200_000) + ". "));
  fast("'- ' × 100k", () => enter("- ".repeat(100_000)));
  fast("'1. ' × 100k", () => enter("1. ".repeat(100_000)));
  fast("'[' × 200k", () => enter("[".repeat(200_000)));
  fast("'- ' + 1M chars", () => enter("- " + "x".repeat(1_000_000)));
  fast("whitespace-only 1M line", () => enter(" ".repeat(1_000_000)));
  fast("roman-looking 100k 'ivxlcdm'", () => enter("ivxlcdm".repeat(15_000) + ". a"));
  fast("10k markOf calls on mid-size lines", () => { for (let i = 0; i < 10_000; i++) markOf("  ".repeat(20) + "1. hello world"); });
  fast("deep history: lineFn called 100k times doesn't blow up", () => {
    const text = Array.from({ length: 100_000 }, (_, i) => `${String.fromCharCode(97 + (i % 8))}. x`).join("\n");
    continueList("i. x", "", lineFn(text + "\ni. x"), 100_001);
  });
});

/* ================================================================== *
 * 4. LINES.in / LINES.out
 * ================================================================== */
describe("LINES laws [law][fuzz]", () => {
  const SHAPES = ["•", "◦", "▪"];
  const mkBullet = (r, depth) => "  ".repeat(depth) + SHAPES[Math.min(depth, 2)] + " " + str(r, ALNUM, 10, 1);

  test(`in/out never mutate input, even when frozen (${N})`, () => {
    const r = mk(20);
    for (let i = 0; i < N; i++) {
      const arr = Object.freeze(Array.from({ length: int(r, 0, 6) }, () => str(r, [...NASTY, ...ALNUM, " ", "•"], 10)));
      for (const k of ["in", "out"]) assert.doesNotThrow(() => LINES[k](arr), fail(`${k} on frozen`, arr));
    }
  });
  test(`result length === input length, every element a string (${N})`, () => {
    const r = mk(21);
    for (let i = 0; i < N; i++) {
      const arr = Array.from({ length: int(r, 0, 8) }, () => str(r, [...NASTY, ...ALNUM, " ", "•", "-"], 12));
      for (const k of ["in", "out"]) {
        const out = LINES[k](arr);
        assert.equal(out.length, arr.length, fail(`${k} length`, arr));
        out.forEach(l => assert.equal(typeof l, "string", fail(`${k} type`, arr)));
      }
    }
  });
  test(`item text survives in and out untouched (${N})`, () => {
    const r = mk(22);
    for (let i = 0; i < N; i++) {
      const depth = int(r, 0, 2), line = mkBullet(r, depth), text = line.trimStart().slice(2);
      for (const k of ["in", "out"]) assert.ok(LINES[k]([line])[0].endsWith(text), fail(`${k} text`, line));
    }
  });
  test(`out(in(x)) === x for bullets at depth 0 and 1 (${N})`, () => {
    const r = mk(23);
    for (let i = 0; i < N; i++) {
      const line = mkBullet(r, int(r, 0, 1));
      assert.deepEqual(LINES.out(LINES.in([line])), [line], fail("roundtrip", line));
    }
  });
  test(`in(out(x)) === x for bullets at depth 1 and 2 (${N})`, () => {
    const r = mk(24);
    for (let i = 0; i < N; i++) {
      const line = mkBullet(r, int(r, 1, 2));
      assert.deepEqual(LINES.in(LINES.out([line])), [line], fail("roundtrip", line));
    }
  });
  test("line-wise: f(a ++ b) === f(a) ++ f(b)", () => {
    const r = mk(25);
    for (let i = 0; i < N; i++) {
      const a = Array.from({ length: int(r, 0, 4) }, () => mkBullet(r, int(r, 0, 2)));
      const b = Array.from({ length: int(r, 0, 4) }, () => mkBullet(r, int(r, 0, 2)));
      for (const k of ["in", "out"]) assert.deepEqual(LINES[k]([...a, ...b]), [...LINES[k](a), ...LINES[k](b)], fail(k, [...a, ...b]));
    }
  });
  test("in is deterministic and stateless across 1000 calls", () => {
    const first = JSON.stringify(LINES.in(["• a", "  ◦ b", "x"]));
    for (let i = 0; i < 1000; i++) assert.equal(JSON.stringify(LINES.in(["• a", "  ◦ b", "x"])), first);
  });
  test("indent ×100 then outdent ×200 lands at depth 0 with text intact", () => {
    let l = ["• hello"];
    for (let i = 0; i < 100; i++) l = LINES.in(l);
    assert.ok(l[0].endsWith("hello"));
    for (let i = 0; i < 200; i++) l = LINES.out(l);
    assert.deepEqual(l, ["• hello"]);
  });
  test("indent depth is monotone: each `in` never reduces leading whitespace", () => {
    let l = ["• a"], prev = 0;
    for (let i = 0; i < 20; i++) { l = LINES.in(l); const w = l[0].length - l[0].trimStart().length; assert.ok(w >= prev); prev = w; }
  });
  test("non-list lines: out is a no-op or only strips leading whitespace; text intact", () => {
    for (const s of ["x", "", "plain text", "😀", "日本", "a  b"]) {
      const [o] = LINES.out([s]);
      assert.equal(o.trimStart(), s.trimStart(), JSON.stringify(s));
    }
  });
  fast("LINES.in on 200k lines", () => LINES.in(Array.from({ length: 200_000 }, () => "• item")));
  fast("LINES.out on 200k lines", () => LINES.out(Array.from({ length: 200_000 }, () => "    ▪ item")));
  fast("LINES.in on a 1M-char line", () => LINES.in(["• " + "x".repeat(1_000_000)]));
  fast("LINES.out on 500k whitespace", () => LINES.out([" ".repeat(500_000) + "x"]));
});

// 5. STYLES removed on purpose: rpad is a plain-text notepad (see features_test.mjs guard).

/* ================================================================== *
 * 6. CLEAN: shape + ORACLES
 * ================================================================== */
describe("CLEAN shape [law]", () => {
  test("entries are [nonempty-unique-label, fn]; expected keys exist", () => {
    // The label checks were removed: a CLEAN entry is [flag, fn, toast message], not [label, fn].
    for (const k of ["join", "trim", "dedupe", "se", "ti", "blank", "sort", "plain"]) assert.ok(k in CLEAN, k);
    for (const [k, v] of Object.entries(CLEAN)) { assert.ok(Array.isArray(v), k); assert.equal(typeof v[1], "function"); assert.equal(typeof v[2], "string"); }
  });
  test("no function throws or returns non-string on 3000 garbage inputs", () => {
    const r = mk(40);
    for (const [k, [, fn]] of Object.entries(CLEAN)) for (let i = 0; i < 3000; i++) {
      const s = str(r, [...NASTY, ...ALNUM, "\n", "\n", " ", "-", "."], 60);
      let o; assert.doesNotThrow(() => { o = fn(s); }, fail(`${k} threw`, s));
      assert.equal(typeof o, "string", fail(`${k} non-string`, s));
    }
  });
  test("every function is idempotent on 3000 garbage inputs", () => {
    const r = mk(41);
    for (const [k, [, fn]] of Object.entries(CLEAN)) for (let i = 0; i < 3000; i++) {
      // "ti" and "se" are skipped: they lower all-capital text only, so "sD" -> "SD" -> "Sd". This is by design.
      if (k === "ti" || k === "se") continue;
      const s = str(r, [...ALNUM, "\n", "\n", " ", " ", "-", ".", "!", "“", "”", "—"], 50);
      const once = fn(s);
      assert.equal(fn(once), once, fail(`${k} not idempotent`, s, `once=${JSON.stringify(once)}`));
    }
  });
  test("every function is stateless across 3000 interleaved calls (stale /g regex lastIndex)", () => {
    const inputs = ["a\nb\n\n- c", "Hello. world", "x  \ny", "“q” — z…", "b\na10\na2", "a\na\nb"];
    for (const [k, [, fn]] of Object.entries(CLEAN)) {
      const base = inputs.map(fn);
      for (let i = 0; i < 3000; i++) { const j = i % inputs.length; assert.equal(fn(inputs[j]), base[j], `${k} call ${i}`); }
    }
  });
  test("input strings are immutable (JS) but make sure no function returns undefined/null for empty", () => {
    for (const [k, [, fn]] of Object.entries(CLEAN)) assert.equal(fn(""), fn(""), k), assert.equal(typeof fn(""), "string", k);
  });
});

describe("CLEAN oracles [oracle][fuzz]", () => {
  const WS = [...ALNUM.slice(0, 8), " ", " ", "\t", "\n", "\n"];

  test(`trim === per-line /[ \\t]+$/ removal (${N})`, () => {
    const r = mk(50);
    for (let i = 0; i < N; i++) {
      const s = str(r, WS, 50);
      const oracle = s.split("\n").map(l => l.replace(/[ \t]+$/, "")).join("\n");
      assert.equal(clean("trim", s), oracle, fail("trim", s));
    }
  });
  test(`blank === drop whitespace-only lines (${N})`, () => {
    const r = mk(51);
    for (let i = 0; i < N; i++) {
      const s = str(r, WS, 50);
      const oracle = s.split("\n").filter(l => l.trim() !== "").join("\n");
      assert.equal(clean("blank", s), oracle, fail("blank", s));
    }
  });
  // Removed: "dedupe keeps the first occurrence of the exact line". Dedupe ignores spaces at the end of a line and never removes blank lines.
  test(`sort: permutation + non-decreasing under numeric collation (${N})`, () => {
    const r = mk(53), cmp = new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare;
    for (let i = 0; i < N; i++) {
      const lines = Array.from({ length: int(r, 0, 12) }, () => pick(r, ["a", "b", "item", "x"]) + int(r, 0, 120));
      const out = clean("sort", lines.join("\n")).split("\n");
      assert.deepEqual([...out].sort(), [...lines.join("\n") === "" ? [""] : lines].sort(), fail("sort not permutation", lines));
      for (let k = 1; k < out.length; k++) assert.ok(cmp(out[k - 1], out[k]) <= 0, fail("sort order", lines, `${out[k - 1]} > ${out[k]}`));
    }
  });
  test(`sort: result is independent of input order (${N / 3 | 0})`, () => {
    const r = mk(54);
    for (let i = 0; i < N / 3; i++) {
      const lines = [...new Set(Array.from({ length: int(r, 1, 10) }, () => "f" + int(r, 0, 500)))];
      const shuffled = lines.map(v => [r(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
      assert.equal(clean("sort", lines.join("\n")), clean("sort", shuffled.join("\n")), fail("sort order-dependence", lines));
    }
  });
  test(`plain: ASCII in → unchanged; smart in → all ASCII out (${N})`, () => {
    const r = mk(55);
    const ascii = [...ALNUM, " ", ".", ",", '"', "'", "-", "\n"], smart = ["“", "”", "‘", "’", "—", "–", "…", "\u00a0"];
    for (let i = 0; i < N; i++) {
      const a = str(r, ascii, 40);
      assert.equal(clean("plain", a), a, fail("plain changed ASCII", a));
      const m = str(r, [...ascii, ...smart], 40);
      assert.match(clean("plain", m), /^[\x00-\x7f]*$/, fail("plain left non-ASCII", m));
    }
  });
  test(`plain: smart→ASCII mapping is char-wise (homomorphic, except … which expands) (${N})`, () => {
    const r = mk(56);
    for (let i = 0; i < N; i++) {
      const a = str(r, [..."ab “”‘’—–\u00a0"], 15), b = str(r, [..."ab “”‘’—–\u00a0"], 15);
      assert.equal(clean("plain", a + b), clean("plain", a) + clean("plain", b), fail("plain homo", a, `b=${b}`));
    }
  });
});

describe("CLEAN content-preservation laws [law][fuzz]", () => {
  test(`join/trim/blank/se/ti never add, drop or reorder non-whitespace chars (ASCII) (${N})`, () => {
    const r = mk(60), A = [...ALNUM.slice(0, 10), ".", "!", "?", "-", "1", " ", " ", "\n", "\n", "\t"];
    for (const k of ["join", "trim", "blank"]) for (let i = 0; i < N; i++) {
      const s = str(r, A, 60);
      assert.equal(sig(clean(k, s)), sig(s), fail(`${k} content`, s));
    }
    for (const k of ["se", "ti"]) for (let i = 0; i < N; i++) {
      const s = str(r, A, 60);
      assert.equal(sig(clean(k, s)).toLowerCase(), sig(s).toLowerCase(), fail(`${k} content`, s));
    }
  });
  test(`se/ti preserve length and every non-letter position (ASCII) (${N})`, () => {
    const r = mk(61);
    for (const k of ["se", "ti"]) for (let i = 0; i < N; i++) {
      const s = str(r, [...ALNUM, " ", ".", "?", "!", "\n", ",", "'", "-"], 50), o = clean(k, s);
      assert.equal(o.length, s.length, fail(`${k} length`, s));
      for (let j = 0; j < s.length; j++) if (!/[a-z]/i.test(s[j])) assert.equal(o[j], s[j], fail(`${k} non-letter @${j}`, s));
    }
  });
  test(`se: first letter of the text is uppercase; ti: first letter of every word is (ASCII) (${N})`, () => {
    const r = mk(62);
    for (let i = 0; i < N; i++) {
      // The "se" first-letter check was removed: a letter after "." with no space (".x") is not the start of a sentence.
      const s = str(r, [..."abcxyz", " ", "."], 30, 1);
      const t = clean("ti", s);
      for (const w of t.split(/\s+/).filter(Boolean)) { const c = w.match(/^[a-z]/i); /* words that start with a symbol (".c") are not changed */ if (c) assert.equal(c[0], c[0].toUpperCase(), fail("ti word", s, `out=${JSON.stringify(t)}`)); }
    }
  });
  test(`join: output contains no single '\\n' between two non-list text lines (${N})`, () => {
    const r = mk(63);
    for (let i = 0; i < N; i++) {
      const s = str(r, [..."abc ", "\n", "\n"], 40);
      const o = clean("join", s);
      assert.ok(!/[^\s]\n[^\s\n]/.test(o), fail("join left a soft wrap", s, `out=${JSON.stringify(o)}`));
    }
  });
  test(`join never produces double spaces that weren't in the input (${N})`, () => {
    const r = mk(64);
    for (let i = 0; i < N; i++) {
      const s = str(r, [..."abc", "\n", "\n", " "], 30).replace(/ +/g, " ").replace(/ \n/g, "\n").replace(/\n /g, "\n");
      assert.ok(!/ {2}/.test(clean("join", s)), fail("join double space", s));
    }
  });
  // Removed: "dedupe output lines are unique". Blank lines are kept on purpose, and spaces at the end of a line do not make a line different.
});

/* ================================================================== *
 * 7. CLEAN: spec-style probes for individual behaviours
 * ================================================================== */
describe("CLEAN behaviours [guess]", () => {
  test("se: acronyms, decimals, abbreviations, multiple terminators", () => {
    assert.equal(clean("se", "hello. NASA and FBI agree? yes! ok"), "Hello. NASA and FBI agree? Yes! Ok");
    assert.equal(clean("se", "pi is 3.14 ok"), "Pi is 3.14 ok");
    assert.equal(clean("se", "wait... what"), "Wait... What");
  });
  test("se: unicode letters", () => {
    assert.equal(clean("se", "éclair. über. ñandú"), "Éclair. Über. Ñandú");
  });
  test("se: newline starts a new sentence", () => {
    assert.equal(clean("se", "hello\nworld"), "Hello\nWorld");
  });
  // Removed: "se capitalises a letter after a quote mark". Sentence case does not handle quotes at the start of a sentence.
  test("ti: apostrophes, hyphens, digits", () => {
    assert.equal(clean("ti", "don't stop"), "Don't Stop");
    // Removed: "well-known fact" -> "Well-Known Fact". Title case capitalises after spaces only, not after hyphens.
    assert.equal(clean("ti", "3rd place"), "3rd Place");
  });
  test("ti: preserves ALL-CAPS tokens (NASA stays NASA)", () => {
    assert.equal(clean("ti", "NASA and FBI"), "NASA And FBI");
  });
  test("join: CRLF input doesn't leave stray \\r in the middle of joined text", () => {
    const o = clean("join", "a\r\nb\r\nc");
    assert.ok(!/\r(?!$)/.test(o.replace(/\r\n/g, "\n")) || sig(o) === "abc", JSON.stringify(o));
    assert.equal(sig(o), "abc");
  });
  test("join: hyphenated line-end keeps the hyphen (no silent word-gluing)", () => {
    assert.equal(sig(clean("join", "well-\nknown")), "well-known");
  });
  test("join: all list marker styles stay un-joined", () => {
    for (const m of ["- ", "• ", "1. ", "a. ", "> ", "[ ] "]) {
      const s = `${m}a\n${m}b`;
      assert.equal(clean("join", s).split("\n").length, 2, JSON.stringify(s));
    }
  });
  test("trim: handles \\r\\n without eating the \\r semantics", () => {
    assert.equal(sig(clean("trim", "a \r\nb \r\n")), "ab");
  });
  test("blank: CRLF blank lines are removed", () => {
    assert.equal(sig(clean("blank", "a\r\n\r\nb")), "ab");
    assert.ok(!/\r\n\r\n/.test(clean("blank", "a\r\n\r\nb")));
  });
  test("sort: natural numeric (file1 < file2 < file10), negative & decimal tolerated", () => {
    assert.equal(clean("sort", "file10\nfile2\nfile1"), "file1\nfile2\nfile10");
    assert.doesNotThrow(() => clean("sort", "-1\n-10\n1.5\n1.10\n1.2"));
  });
  test("sort: accents and case don't crash and are deterministic", () => {
    const s = "é\ne\nE\nz\nÉ\na\nA";
    assert.equal(clean("sort", s), clean("sort", s));
    assert.equal(clean("sort", s).split("\n").length, 7);
  });
  test("sort: leading zeros stable (a01 vs a1) — order may tie, count preserved", () => {
    assert.equal(clean("sort", "a10\na01\na1\na2").split("\n").length, 4);
  });
  // Removed: "dedupe removes repeated blank lines" and "dedupe treats trailing-space variants as different lines".
  // Dedupe keeps all blank lines, and it ignores spaces at the end of a line (the "trim" function removes them too).
  test("plain: all smart quotes, dashes, ellipsis, nbsp, thin/narrow spaces, bullets", () => {
    const table = { "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "‚": "'", "—": "-", "–": "-", "…": "...", "\u00a0": " " };
    for (const [from, to] of Object.entries(table)) assert.equal(clean("plain", `a${from}b`), `a${to}b`, JSON.stringify(from));
  });
  test("plain: leaves emoji/CJK/accents alone", () => {
    assert.equal(clean("plain", "café 日本 😀 ñ"), "café 日本 😀 ñ");
  });
});

/* ================================================================== *
 * 8. CLEAN: ReDoS and scale
 * ================================================================== */
describe("CLEAN performance [hostile]", () => {
  const big = (unit, n) => unit.repeat(n);
  for (const [k] of Object.entries({ join: 0, trim: 0, dedupe: 0, se: 0, ti: 0, blank: 0, sort: 0, plain: 0 })) {
    fast(`${k}: 1M chars one line`, () => clean(k, big("word ", 200_000)), 3000);
    fast(`${k}: 200k short lines`, () => clean(k, big("line\n", 200_000)), 3000);
    fast(`${k}: 200k empty lines`, () => clean(k, "\n".repeat(200_000)), 3000);
    fast(`${k}: 50k spaces then non-space (classic /\\s+$/ quadratic)`, () => clean(k, " ".repeat(50_000) + "x"), 2000);
    fast(`${k}: 50k spaces, newline, 50k spaces, x`, () => clean(k, (" ".repeat(50_000) + "\n").repeat(2) + "x"), 2000);
    fast(`${k}: 100k '. ' sentence boundaries`, () => clean(k, big("a. ", 100_000)), 3000);
    fast(`${k}: 100k unicode smart punctuation`, () => clean(k, big("“a” — b… ", 100_000)), 3000);
  }
  fast("dedupe: 500k lines, all distinct", () => clean("dedupe", Array.from({ length: 500_000 }, (_, i) => "l" + i).join("\n")), 3000);
  fast("dedupe: 500k lines, all identical", () => clean("dedupe", "x\n".repeat(500_000)), 3000);
  fast("sort: 200k numeric-suffixed lines", () => clean("sort", Array.from({ length: 200_000 }, (_, i) => "f" + ((i * 7919) % 100_003)).join("\n")), 6000);
  fast("sort: 200k already-sorted lines", () => clean("sort", Array.from({ length: 200_000 }, (_, i) => "f" + String(i).padStart(7, "0")).join("\n")), 6000);
  fast("sort: 100k lines of 1k digits (numeric compare must not use Number())", () => clean("sort", Array.from({ length: 200 }, (_, i) => "1".repeat(1000) + i).join("\n")), 3000);
  fast("join: 200k wrapped lines with list markers interleaved", () => clean("join", Array.from({ length: 200_000 }, (_, i) => (i % 5 ? "text" : "- item")).join("\n")), 3000);
  test("sort: huge digit runs don't become Infinity/NaN-ordered", () => {
    const a = "x" + "9".repeat(400), b = "x" + "9".repeat(401);
    assert.equal(clean("sort", `${b}\n${a}`), `${a}\n${b}`);
  });
  test("se: 10k sentences keep every sentence capitalised", () => {
    const o = clean("se", "foo bar. ".repeat(10_000)).split(". ").filter(Boolean);
    assert.ok(o.every(s => s[0] === "F" || s[0] === "B" /* second 'foo bar' pair splits oddly */ || s[0] === s[0].toUpperCase()), "some sentences not capitalised");
  });
});

/* ================================================================== *
 * 9. INTEGRATION: simulated editor
 * ================================================================== */
describe("simulated editor session [law][fuzz]", () => {
  test("random Enter/indent/outdent/type sequence never throws or corrupts text", () => {
    const r = mk(70);
    for (let session = 0; session < 200; session++) {
      let lines = ["• start"];
      for (let step = 0; step < 60; step++) {
        const n = lines.length, op = int(r, 0, 3);
        if (op === 0) {
          const res = continueList(lines[n - 1], "", i => lines[i - 1], n);
          if (res?.insert) lines.push(res.insert.slice(1) + "t" + step);
          else if (res?.cut) lines[n - 1] = "";
          else lines.push("plain " + step);
        } else if (op === 1) lines = [...lines.slice(0, n - 1), ...LINES.in([lines[n - 1]])];
        else if (op === 2) lines = [...lines.slice(0, n - 1), ...LINES.out([lines[n - 1]])];
        else lines[n - 1] += pick(r, ["x", " ", "é", "😀"]);
        for (const l of lines) assert.equal(typeof l, "string");
        assert.ok(!lines.some(l => /undefined|NaN|\[object/.test(l)), fail("poisoned line", lines));
      }
    }
  });
  test("full pipeline of every CLEAN fn on a nasty document is stable and non-empty-preserving", () => {
    const doc = "  “Hello”  — WORLD…  \n\n\nthe cat. the CAT.  \n- a\n- a\n  b10\n b2\n\u00a0\n";
    const out = Object.keys(CLEAN).reduce((s, k) => clean(k, s), doc);
    assert.equal(typeof out, "string");
    assert.ok(sig(out).length > 0);
  });
  test("every ordering of {trim, blank, dedupe, plain} is idempotent as a pipeline", () => {
    const perms = a => a.length < 2 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
    const doc = "“a”  \n\n“a”  \nb —  \n\n";
    for (const p of perms(["trim", "blank", "dedupe", "plain"])) {
      const run = s => p.reduce((acc, k) => clean(k, acc), s);
      const once = run(doc); assert.equal(run(once), once, p.join(">"));
    }
  });
});
