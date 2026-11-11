import { test } from "node:test";
import assert from "node:assert/strict";
import { continueList, LINES, CLEAN, markOf } from "../src/textops.js";

const lineFn = text => { const L = text.split("\n"); return n => L[n - 1] };
// Enter at the end of line n of `text`
const enter = (text, n) => { const L = text.split("\n"); return continueList(L[n - 1], "", lineFn(text), n) };

test("Enter continues each kind of list", () => {
  assert.deepEqual(enter("- a", 1), { insert: "\n- " });
  assert.deepEqual(enter("• a", 1), { insert: "\n• " });
  assert.deepEqual(enter("[x] done", 1), { insert: "\n[ ] " });
  assert.deepEqual(enter("1. a", 1), { insert: "\n2. " });
  assert.deepEqual(enter("9. a", 1), { insert: "\n10. " });
  assert.deepEqual(enter("a. a", 1), { insert: "\nb. " });
  assert.deepEqual(enter("  - nested", 1), { insert: "\n  - " });
  assert.deepEqual(enter("> quote", 1), { insert: "\n> " });
});
test("roman numerals continue, and a lone i starts a roman list", () => {
  assert.deepEqual(enter("i. a", 1), { insert: "\nii. " });
  assert.deepEqual(enter("iii. a", 1), { insert: "\niv. " });
  assert.deepEqual(enter("h. a\ni. b", 2), { insert: "\nj. " });
});
test("an empty item ends the list; plain lines fall through", () => {
  assert.deepEqual(enter("- ", 1), { cut: true });
  assert.equal(enter("hello", 1), null);
  assert.equal(enter("mid. word", 1), null);
  assert.equal(markOf("mid. x"), null);
});
test("Enter inside the marker, or before text, behaves", () => {
  assert.equal(continueList("-", "", lineFn("-"), 1), null);
  assert.deepEqual(continueList("- ab", "cd", lineFn("- abcd"), 1), { insert: "\n- " });
});
test("indent and outdent change bullet shape", () => {
  assert.deepEqual(LINES.in(["• a"]), ["  ◦ a"]);
  assert.deepEqual(LINES.in(["  ◦ a"]), ["    ▪ a"]);
  assert.deepEqual(LINES.out(["    ▪ a"]), ["  ◦ a"]);
  assert.deepEqual(LINES.out(["x"]), ["x"]);
});
test("clean up", () => {
  assert.equal(CLEAN.join[1]("a\nb\n\n- c\n- d"), "a b\n\n- c\n- d");
  assert.equal(CLEAN.trim[1]("a  b  \nc"), "a  b\nc");
  assert.equal(CLEAN.dedupe[1]("a\n  a\na"), "a\n  a");
  assert.equal(CLEAN.se[1]("I think NASA is good. yes"), "I think NASA is good. Yes");
  assert.equal(CLEAN.ti[1]("NASA reports"), "NASA Reports");
  assert.equal(CLEAN.blank[1]("a\n\nb"), "a\nb");
  assert.equal(CLEAN.sort[1]("b\na10\na2"), "a2\na10\nb");
  assert.equal(CLEAN.dedupe[1]("a\nb\na"), "a\nb");
  assert.equal(CLEAN.plain[1]("“hi” — ok"), '"hi" - ok');
  assert.equal(CLEAN.se[1]("HELLO. WORLD"), "Hello. World");
});
