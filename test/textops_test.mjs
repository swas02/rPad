import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { continueList, LINES, CLEAN, markOf } from "../src/textops.js";

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */
const lineFn = text => { const L = text.split("\n"); return n => L[n - 1]; };
// Enter at the end of line n of `text`
const enter = (text, n) => { const L = text.split("\n"); return continueList(L[n - 1], "", lineFn(text), n); };
// Enter with the caret in the middle of a line
const split = (before, after, n = 1, text = before + after) => continueList(before, after, lineFn(text), n);
const clean = (key, s) => CLEAN[key][1](s);

/*
 * Sections marked [original] extend the contract your existing tests already pin down.
 * Sections marked [probe] encode my best reading of the intended behaviour for cases the
 * original tests don't cover. If one fails, decide whether the code or the expectation is wrong.
 */

/* ================================================================== *
 * continueList
 * ================================================================== */
describe("continueList: kinds of list [original+]", () => {
  const cases = [
    // [input line, expected insert]
    ["- a", "\n- "],
    ["• a", "\n• "],
    ["> quote", "\n> "],
    ["[x] done", "\n[ ] "],
    ["[ ] todo", "\n[ ] "],
    ["1. a", "\n2. "],
    ["9. a", "\n10. "],
    ["99. a", "\n100. "],
    ["a. a", "\nb. "],
    ["i. a", "\nii. "],
    ["iii. a", "\niv. "],
    ["  - nested", "\n  - "],
    ["    - deeper", "\n    - "],
    ["\t- tab", "\n\t- "],
    ["  1. nested num", "\n  2. "],
    ["  [ ] nested todo", "\n  [ ] "],
    ["  > nested quote", "\n  > "],
    ["- a b c d", "\n- "],
    ["- ünïcödé 😀", "\n- "],
    ["1. 2. 3.", "\n2. "],
  ];
  for (const [input, insert] of cases) {
    test(JSON.stringify(input), () => assert.deepEqual(enter(input, 1), { insert }));
  }
});

describe("continueList: numbering [original+]", () => {
  test("every number 1..120 increments by one", () => {
    for (let i = 1; i <= 120; i++) {
      assert.deepEqual(enter(`${i}. x`, 1), { insert: `\n${i + 1}. ` }, `at ${i}`);
    }
  });
  test("letters a..y advance to the next letter (skipping the roman-ambiguous i)", () => {
    const L = "abcdefghijklmnopqrstuvwxy";
    for (let k = 0; k < L.length - 1; k++) {
      const cur = L[k], next = L[k + 1];
      if (cur === "i" || cur === "h" || cur === "v" || cur === "x") continue; // roman-ambiguous, tested separately
      assert.deepEqual(enter(`${cur}. x`, 1), { insert: `\n${next}. ` }, cur);
    }
  });
  test("roman numerals i..iv advance", () => {
    // Stops at "iv": a single "v." or "x." with no roman item before it is read as a letter list, by design.
    const R = ["i", "ii", "iii", "iv"];
    for (let k = 0; k < R.length - 1; k++) {
      assert.deepEqual(enter(`${R[k]}. x`, 1), { insert: `\n${R[k + 1]}. ` }, R[k]);
    }
  });
  test("a lone i after h is a letter, not a roman numeral", () => {
    assert.deepEqual(enter("h. a\ni. b", 2), { insert: "\nj. " });
  });
  test("a lone i with no context starts a roman list", () => {
    assert.deepEqual(enter("i. a", 1), { insert: "\nii. " });
  });
  test("[probe] i after a non-list line is still roman", () => {
    assert.deepEqual(enter("intro\ni. a", 2), { insert: "\nii. " });
  });
  test("[probe] ii after i continues roman, never letters", () => {
    assert.deepEqual(enter("i. a\nii. b", 2), { insert: "\niii. " });
  });
  test("[probe] numbering ignores what is on earlier lines", () => {
    assert.deepEqual(enter("1. a\n5. b", 2), { insert: "\n6. " });
  });
  // Removed: "uppercase letters / romans keep their case". The list marker pattern (LRE) accepts lower case markers only.
  test("[probe] indentation is preserved on numbered/lettered/roman lists", () => {
    assert.deepEqual(enter("    a. x", 1), { insert: "\n    b. " });
    assert.deepEqual(enter("  iii. x", 1), { insert: "\n  iv. " });
  });
});

describe("continueList: empty item ends the list [original+]", () => {
  for (const empty of ["- ", "• ", "> ", "[ ] ", "[x] ", "1. ", "a. ", "i. ", "  - ", "    1. "]) {
    test(`[probe] ${JSON.stringify(empty)} → cut`, () => {
      assert.deepEqual(enter(empty, 1), { cut: true });
    });
  }
  test("original: '- ' → cut", () => assert.deepEqual(enter("- ", 1), { cut: true }));
  test("[probe] an empty item deep in a list still cuts", () => {
    assert.deepEqual(enter("- a\n- b\n- ", 3), { cut: true });
  });
});

describe("continueList: plain lines fall through [original+]", () => {
  for (const plain of [
    "hello", "", " ", "   ", "mid. word", "word. next", "foo-bar", "a-b", "-a", "•a", ">a",
    "1.a", "1 a", "a.b", "Hello world.", "e.g. this", "etc. etc.", "ab. c", "[ ]x",
    "2024-01-01", "3.14 is pi", "-- not a list", "---", "***",
  ]) {
    test(`[probe] ${JSON.stringify(plain)} → null`, () => assert.equal(enter(plain, 1), null));
  }
  test("original: hello / mid. word", () => {
    assert.equal(enter("hello", 1), null);
    assert.equal(enter("mid. word", 1), null);
  });
});

describe("continueList: caret position [original+]", () => {
  test("original: caret inside marker → null", () => {
    assert.equal(continueList("-", "", lineFn("-"), 1), null);
  });
  test("original: caret mid-text splits and continues", () => {
    assert.deepEqual(continueList("- ab", "cd", lineFn("- abcd"), 1), { insert: "\n- " });
  });
  test("[probe] caret at start of list text on a non-empty item continues", () => {
    assert.deepEqual(split("- ", "abc"), { insert: "\n- " });
  });
  test("[probe] numbered split keeps increasing", () => {
    assert.deepEqual(split("3. ab", "cd"), { insert: "\n4. " });
  });
  test("[probe] caret inside marker for other kinds → null", () => {
    for (const m of ["•", ">", "1.", "a.", "[", "[ ]", "[x"]) {
      assert.equal(continueList(m, "", lineFn(m), 1), null, m);
    }
  });
  test("[probe] caret before the marker of an indented item → null", () => {
    assert.equal(continueList("  ", "- a", lineFn("  - a"), 1), null);
    assert.equal(continueList("", "- a", lineFn("- a"), 1), null);
  });
  test("[probe] trailing space after text doesn't end the list", () => {
    assert.deepEqual(enter("- a  ", 1), { insert: "\n- " });
  });
  test("[probe] 'after' text on a plain line stays null", () => {
    assert.equal(split("hel", "lo"), null);
  });
});

describe("continueList: result shape [probe]", () => {
  test("only returns {insert:string}, {cut:true} or null", () => {
    const inputs = ["- a", "- ", "x", "", "1. a", "1. ", "[ ] ", "> ", "i. a", "  • a", "a. ", "–", "- - -"];
    for (const s of inputs) {
      const r = enter(s, 1);
      if (r === null) continue;
      assert.ok(typeof r === "object");
      const keys = Object.keys(r);
      assert.equal(keys.length, 1, `${s} → ${JSON.stringify(r)}`);
      if (keys[0] === "insert") { assert.equal(typeof r.insert, "string"); assert.ok(r.insert.startsWith("\n")); }
      else { assert.deepEqual(r, { cut: true }); }
    }
  });
  test("insert always starts with a newline and re-parses as a list item", () => {
    for (const s of ["- a", "• a", "1. a", "a. a", "i. a", "[x] a", "> a", "  - a", "  2. a"]) {
      const { insert } = enter(s, 1);
      assert.ok(markOf(insert.slice(1) + "x") !== null, `${s} → ${JSON.stringify(insert)}`);
    }
  });
  test("pressing Enter repeatedly keeps counting", () => {
    let text = "1. a";
    for (let i = 0; i < 12; i++) {
      const n = text.split("\n").length;
      const r = enter(text + (text.endsWith(" ") ? "x" : ""), n);
      assert.ok(r && r.insert, `step ${i}`);
      text += r.insert + "x";
    }
    const lines = text.split("\n");
    assert.equal(lines.length, 13);
    assert.equal(lines[12].startsWith("13. "), true);
  });
  test("does not throw if lineFn returns undefined for out-of-range lines", () => {
    assert.doesNotThrow(() => continueList("i. a", "", () => undefined, 1));
    assert.doesNotThrow(() => continueList("i. a", "", () => undefined, 5));
    assert.doesNotThrow(() => continueList("h. a", "", n => (n === 1 ? undefined : "x"), 2));
  });
});

/* ================================================================== *
 * markOf
 * ================================================================== */
describe("markOf", () => {
  test("original: plain 'mid. x' → null", () => assert.equal(markOf("mid. x"), null));
  for (const s of ["- a", "• a", "1. a", "a. a", "i. a", "> a", "[ ] a", "[x] a", "  - a", "    10. a"]) {
    test(`[probe] ${JSON.stringify(s)} is a list line`, () => assert.notEqual(markOf(s), null));
  }
  for (const s of ["", "hello", "-a", "1.a", "foo - bar", "a-b", "mid. word", "word. next"]) {
    test(`[probe] ${JSON.stringify(s)} is not a list line`, () => assert.equal(markOf(s), null));
  }
  test("[probe] is pure — same input, same output", () => {
    assert.deepEqual(markOf("- a"), markOf("- a"));
    assert.deepEqual(markOf("3. a"), markOf("3. a"));
  });
  test("[probe] different kinds are distinguishable", () => {
    assert.notDeepEqual(markOf("- a"), markOf("1. a"));
    assert.notDeepEqual(markOf("- a"), markOf("> a"));
  });
  test("[probe] indent level is distinguishable", () => {
    assert.notDeepEqual(markOf("- a"), markOf("  - a"));
  });
});

/* ================================================================== *
 * LINES (indent / outdent)
 * ================================================================== */
describe("LINES.in / LINES.out", () => {
  test("original: bullet shape cycles • ◦ ▪", () => {
    assert.deepEqual(LINES.in(["• a"]), ["  ◦ a"]);
    assert.deepEqual(LINES.in(["  ◦ a"]), ["    ▪ a"]);
    assert.deepEqual(LINES.out(["    ▪ a"]), ["  ◦ a"]);
    assert.deepEqual(LINES.out(["x"]), ["x"]);
  });
  test("[probe] outdent chain returns to top level", () => {
    assert.deepEqual(LINES.out(["  ◦ a"]), ["• a"]);
    assert.deepEqual(LINES.out(LINES.out(["    ▪ a"])), ["• a"]);
  });
  test("[probe] in then out is identity for bullets", () => {
    for (const l of ["• a", "  ◦ a"]) assert.deepEqual(LINES.out(LINES.in([l])), [l]);
  });
  test("[probe] out then in is identity from a nested bullet", () => {
    assert.deepEqual(LINES.in(LINES.out(["  ◦ a"])), ["  ◦ a"]);
  });
  test("[probe] applies to every line of a selection", () => {
    assert.deepEqual(LINES.in(["• a", "• b", "• c"]), ["  ◦ a", "  ◦ b", "  ◦ c"]);
    assert.deepEqual(LINES.out(["  ◦ a", "  ◦ b"]), ["• a", "• b"]);
  });
  test("[probe] mixed depths in one selection each move one step", () => {
    assert.deepEqual(LINES.in(["• a", "  ◦ b"]), ["  ◦ a", "    ▪ b"]);
  });
  test("[probe] empty selection", () => {
    assert.deepEqual(LINES.in([]), []);
    assert.deepEqual(LINES.out([]), []);
  });
  test("[probe] does not mutate its input", () => {
    const src = ["• a", "• b"]; const copy = [...src];
    LINES.in(src); LINES.out(src);
    assert.deepEqual(src, copy);
  });
  test("[probe] returns the same number of lines", () => {
    const src = ["• a", "", "plain", "  ◦ b", "1. n"];
    assert.equal(LINES.in(src).length, src.length);
    assert.equal(LINES.out(src).length, src.length);
  });
  test("[probe] item text is never altered", () => {
    const [r] = LINES.in(["• hello  world 😀"]);
    assert.ok(r.endsWith("hello  world 😀"));
  });
  test("[probe] outdent at top level is a no-op for every kind", () => {
    for (const l of ["• a", "- a", "1. a", "> a", "plain", ""]) assert.deepEqual(LINES.out([l]), [l], l);
  });
  test("[probe] out never produces negative indentation or loses text", () => {
    for (const l of ["  x", "   x", " x", "\tx"]) {
      const [r] = LINES.out([l]);
      assert.ok(r.trimStart() === "x" && r.length <= l.length, JSON.stringify(l));
    }
  });
  test("[probe] repeated indent never throws and keeps text", () => {
    let l = ["• a"];
    for (let i = 0; i < 12; i++) l = LINES.in(l);
    assert.ok(l[0].endsWith("a"));
  });
  test("[probe] repeated outdent eventually stabilises", () => {
    let l = ["    ▪ a"];
    for (let i = 0; i < 8; i++) l = LINES.out(l);
    assert.deepEqual(l, ["• a"]);
  });
});

// STYLES (bold, italic, monospace, superscript, subscript, strike, underline) were removed on purpose:
// rpad is a plain-text notepad and Unicode look-alike styles broke in search, fonts and copy. See the guard in features_test.mjs.

describe("CLEAN: shape [probe]", () => {
  test("every entry is [label, fn]", () => {
    for (const [k, v] of Object.entries(CLEAN)) {
      assert.ok(Array.isArray(v), k);
      // The label checks were removed: a CLEAN entry is [flag, fn, toast message], not [label, fn].
      assert.equal(typeof v[1], "function", `${k} fn`);
    }
  });
  test("all the keys the UI relies on exist", () => {
    for (const k of ["join", "trim", "dedupe", "se", "ti", "blank", "sort", "plain"]) assert.ok(k in CLEAN, k);
  });
  // Removed: "labels are unique". CLEAN entries have no label (v[0] is a number flag).
  test("every fn returns a string for odd inputs and never throws", () => {
    for (const [k, [, fn]] of Object.entries(CLEAN)) {
      for (const s of ["", " ", "\n", "\n\n", "a", "a\n", "\na", "\r\n", "😀", "x".repeat(5000), "a\nb\nc\n".repeat(200)]) {
        assert.doesNotThrow(() => fn(s), `${k}(${JSON.stringify(s.slice(0, 12))})`);
        assert.equal(typeof fn(s), "string", k);
      }
    }
  });
  test("every fn is deterministic", () => {
    const s = "Hello.  world\n\n- a\n- a\n  b  \n“q” — x";
    for (const [k, [, fn]] of Object.entries(CLEAN)) assert.equal(fn(s), fn(s), k);
  });
  test("[probe] every fn is idempotent", () => {
    // join/se/ti are idempotent for any normal text too
    const samples = [
      "a\nb\n\n- c\n- d", "  x  \n\ty\t\n", "a\na\nb\nb\na", "i think NASA. ok", "the quick brown fox",
      "a\n\n\nb\n\n", "b\na10\na2\nA1", "“hi” — ‘there’ … ok", "", "single",
    ];
    for (const [k, [, fn]] of Object.entries(CLEAN)) {
      for (const s of samples) { const once = fn(s); assert.equal(fn(once), once, `${k}(${JSON.stringify(s)})`); }
    }
  });
});

describe("CLEAN.join (re-join wrapped lines) [original+]", () => {
  test("original", () => assert.equal(clean("join", "a\nb\n\n- c\n- d"), "a b\n\n- c\n- d"));
  test("[probe] single line unchanged", () => assert.equal(clean("join", "hello"), "hello"));
  test("[probe] three wrapped lines → one", () => assert.equal(clean("join", "a\nb\nc"), "a b c"));
  test("[probe] paragraph breaks survive", () => assert.equal(clean("join", "a\nb\n\nc\nd"), "a b\n\nc d"));
  test("[probe] list items stay on their own lines", () => {
    assert.equal(clean("join", "- a\n- b\n- c"), "- a\n- b\n- c");
    assert.equal(clean("join", "1. a\n2. b"), "1. a\n2. b");
    assert.equal(clean("join", "• a\n• b"), "• a\n• b");
  });
  test("[probe] text before a list is not glued to the list", () => {
    assert.equal(clean("join", "intro\n- a\n- b"), "intro\n- a\n- b");
  });
  test("[probe] empty input", () => assert.equal(clean("join", ""), ""));
  test("[probe] only blank lines are kept as-is (no content to join)", () => {
    assert.equal(clean("join", "\n\n"), "\n\n");
  });
  test("[probe] no double spaces are introduced", () => {
    assert.ok(!clean("join", "a \nb").includes("  "));
  });
});

describe("CLEAN.trim (trailing whitespace) [original+]", () => {
  test("original", () => assert.equal(clean("trim", "a  b  \nc"), "a  b\nc"));
  test("[probe] tabs", () => assert.equal(clean("trim", "a\t\t\nb"), "a\nb"));
  test("[probe] leading whitespace preserved", () => assert.equal(clean("trim", "  a  "), "  a"));
  test("[probe] whitespace-only lines become empty", () => assert.equal(clean("trim", "a\n   \nb"), "a\n\nb"));
  test("[probe] already clean text unchanged", () => assert.equal(clean("trim", "a\nb\nc"), "a\nb\nc"));
  test("[probe] empty", () => assert.equal(clean("trim", ""), ""));
  test("[probe] line count preserved", () => {
    assert.equal(clean("trim", " a \n\n b ").split("\n").length, 3);
  });
  test("[probe] trailing newline preserved", () => assert.equal(clean("trim", "a  \n"), "a\n"));
  test("[probe] non-breaking space at end is not eaten silently (or is — pin it)", () => {
    const r = clean("trim", "a\u00a0");
    assert.ok(r === "a" || r === "a\u00a0");
  });
});

describe("CLEAN.dedupe (remove duplicate lines) [original+]", () => {
  test("original: indentation-sensitive, keeps first", () => assert.equal(clean("dedupe", "a\n  a\na"), "a\n  a"));
  test("original: a b a", () => assert.equal(clean("dedupe", "a\nb\na"), "a\nb"));
  test("[probe] keeps first occurrence order", () => assert.equal(clean("dedupe", "c\nb\nc\na\nb"), "c\nb\na"));
  test("[probe] all same → one", () => assert.equal(clean("dedupe", "x\nx\nx\nx"), "x"));
  test("[probe] no duplicates → unchanged", () => assert.equal(clean("dedupe", "a\nb\nc"), "a\nb\nc"));
  test("[probe] case-sensitive", () => assert.equal(clean("dedupe", "a\nA"), "a\nA"));
  test("[probe] single line", () => assert.equal(clean("dedupe", "a"), "a"));
  test("[probe] large input stays fast and correct", () => {
    const src = Array.from({ length: 20000 }, (_, i) => `line ${i % 500}`).join("\n");
    const out = clean("dedupe", src).split("\n");
    assert.equal(out.length, 500);
    assert.equal(out[0], "line 0");
    assert.equal(out[499], "line 499");
  });
});

describe("CLEAN.se (sentence case) [original+]", () => {
  test("original: keeps acronym, caps next sentence", () => {
    assert.equal(clean("se", "I think NASA is good. yes"), "I think NASA is good. Yes");
  });
  test("original: ALL CAPS is lowered", () => assert.equal(clean("se", "HELLO. WORLD"), "Hello. World"));
  test("[probe] first letter capitalised", () => assert.equal(clean("se", "hello world"), "Hello world"));
  test("[probe] ? and ! end sentences", () => assert.equal(clean("se", "what? really! yes"), "What? Really! Yes"));
  test("[probe] already correct text unchanged", () => {
    assert.equal(clean("se", "This is fine. So is this."), "This is fine. So is this.");
  });
  test("[probe] multiple spaces after period", () => assert.equal(clean("se", "a.  b"), "A.  B"));
  test("[probe] empty and whitespace", () => {
    assert.equal(clean("se", ""), "");
    assert.equal(clean("se", "   "), "   ");
  });
  test("[probe] digits at sentence start don't break", () => assert.equal(clean("se", "1 apple. 2 pears"), "1 apple. 2 pears"));
  test("[probe] decimal points are not sentence ends", () => assert.equal(clean("se", "pi is 3.14 ok"), "Pi is 3.14 ok"));
  test("[probe] non-ASCII letters", () => assert.equal(clean("se", "éclair. über"), "Éclair. Über"));
  test("[probe] multi-line text", () => assert.equal(clean("se", "hello\nworld"), "Hello\nWorld"));
});

describe("CLEAN.ti (title case) [original+]", () => {
  test("original", () => assert.equal(clean("ti", "NASA reports"), "NASA Reports"));
  test("[probe] lower → title", () => assert.equal(clean("ti", "the quick brown fox"), "The Quick Brown Fox"));
  test("[probe] already title-cased unchanged", () => assert.equal(clean("ti", "Hello World"), "Hello World"));
  test("[probe] hyphenated words don't throw and keep the hyphen", () => {
    assert.ok(clean("ti", "well-known fact").includes("-"));
  });
  test("[probe] apostrophes don't capitalise mid-word", () => assert.equal(clean("ti", "don't stop"), "Don't Stop"));
  test("[probe] preserves whitespace and line breaks", () => assert.equal(clean("ti", "a  b\nc"), "A  B\nC"));
  test("[probe] numbers and punctuation untouched", () => assert.equal(clean("ti", "2024 report, final"), "2024 Report, Final"));
  test("[probe] empty", () => assert.equal(clean("ti", ""), ""));
});

describe("CLEAN.blank (remove blank lines) [original+]", () => {
  test("original", () => assert.equal(clean("blank", "a\n\nb"), "a\nb"));
  test("[probe] many blanks", () => assert.equal(clean("blank", "a\n\n\n\nb"), "a\nb"));
  test("[probe] leading/trailing blanks", () => assert.equal(clean("blank", "\n\na\nb\n\n"), "a\nb"));
  test("[probe] whitespace-only lines count as blank", () => assert.equal(clean("blank", "a\n  \n\t\nb"), "a\nb"));
  test("[probe] no blanks → unchanged", () => assert.equal(clean("blank", "a\nb"), "a\nb"));
  test("[probe] only blanks → empty", () => assert.equal(clean("blank", "\n\n\n"), ""));
  test("[probe] content lines keep their indentation", () => assert.equal(clean("blank", "  a\n\n    b"), "  a\n    b"));
});

describe("CLEAN.sort (natural sort) [original+]", () => {
  test("original", () => assert.equal(clean("sort", "b\na10\na2"), "a2\na10\nb"));
  test("[probe] pure numbers sort numerically", () => assert.equal(clean("sort", "10\n9\n1\n100"), "1\n9\n10\n100"));
  test("[probe] already sorted unchanged", () => assert.equal(clean("sort", "a\nb\nc"), "a\nb\nc"));
  test("[probe] reverse sorted", () => assert.equal(clean("sort", "c\nb\na"), "a\nb\nc"));
  test("[probe] single line", () => assert.equal(clean("sort", "x"), "x"));
  test("[probe] duplicates are kept", () => assert.equal(clean("sort", "b\na\nb"), "a\nb\nb"));
  test("[probe] file1/file2/file10 ordering", () => {
    assert.equal(clean("sort", "file10\nfile2\nfile1"), "file1\nfile2\nfile10");
  });
  test("[probe] line count preserved", () => {
    const src = "z\ny\nx\nx\n1\n2";
    assert.equal(clean("sort", src).split("\n").length, src.split("\n").length);
  });
  test("[probe] same multiset of lines", () => {
    const src = ["q", "a2", "a10", "b", "A", "a", "10"];
    const out = clean("sort", src.join("\n")).split("\n");
    assert.deepEqual([...out].sort(), [...src].sort());
  });
  test("[probe] output is non-decreasing under natural compare", () => {
    const cmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
    const src = Array.from({ length: 200 }, (_, i) => `item${(i * 37) % 101}`);
    const out = clean("sort", src.join("\n")).split("\n");
    for (let i = 1; i < out.length; i++) assert.ok(cmp(out[i - 1], out[i]) <= 0, `${out[i - 1]} > ${out[i]}`);
  });
});

describe("CLEAN.plain (smart → plain punctuation) [original+]", () => {
  test("original", () => assert.equal(clean("plain", "“hi” — ok"), '"hi" - ok'));
  test("[probe] single curly quotes", () => assert.equal(clean("plain", "‘a’ it’s"), "'a' it's"));
  test("[probe] en dash", () => assert.equal(clean("plain", "1–2"), "1-2"));
  test("[probe] ellipsis", () => assert.equal(clean("plain", "wait…"), "wait..."));
  test("[probe] non-breaking space", () => assert.equal(clean("plain", "a\u00a0b"), "a b"));
  test("[probe] plain ASCII unchanged", () => assert.equal(clean("plain", 'He said "hi" - ok...'), 'He said "hi" - ok...'));
  test("[probe] ordinary letters, accents and emoji are not stripped", () => {
    assert.equal(clean("plain", "café 😀"), "café 😀");
  });
  test("[probe] output contains none of the smart characters", () => {
    const out = clean("plain", "“a” ‘b’ — – … \u00a0");
    assert.ok(!/[“”‘’—–…\u00a0]/.test(out), out);
  });
});

/* ================================================================== *
 * Cross-module integration [probe]
 * ================================================================== */
describe("integration [probe]", () => {
  test("typing a list: Enter ×3 then Enter on empty item ends the list", () => {
    let text = "- one";
    for (const word of ["two", "three"]) {
      const r = enter(text, text.split("\n").length);
      text += r.insert + word;
    }
    assert.equal(text, "- one\n- two\n- three");
    const r = enter(text + "\n- ", text.split("\n").length + 1);
    assert.deepEqual(r, { cut: true });
  });
  test("indent a bullet, then Enter continues at the new depth", () => {
    const [nested] = LINES.in(["• a"]);
    assert.deepEqual(enter(nested, 1), { insert: `\n${nested.slice(0, nested.indexOf("◦"))}◦ ` });
  });
  test("clean pipeline: trim → blank → dedupe → sort", () => {
    const src = "b  \n\na10\n  \na2\nb";
    const out = [ "trim", "blank", "dedupe", "sort" ].reduce((s, k) => clean(k, s), src);
    assert.equal(out, "a2\na10\nb");
  });
  test("clean pipeline order independence for trim/blank", () => {
    const src = "a  \n  \nb\n\n";
    assert.equal(clean("blank", clean("trim", src)), clean("trim", clean("blank", src)));
  });
  test("plain then se: smart quotes removed then sentence-cased", () => {
    assert.equal(clean("se", clean("plain", "“hello”. world")), '"hello". World');
  });
});
