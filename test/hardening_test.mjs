// Hard-input tests for the plain-text actions that remain. Only public exports are used.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LINES, CLEAN, INSERT, continueList } from "../src/textops.js";

const run = (k, t) => CLEAN[k][1](t);
const hard = ["", " ", "\n", "a", "a\n", "\n\na", "a\r\nb", "😀 emoji 😀", "é combining", "x".repeat(100000), "\t tab", "a\n\n\nb"];

describe("clean up never throws and never loses non-space characters", () => {
  for (const k of Object.keys(CLEAN)) test(k, () => {
    for (const s of hard) assert.doesNotThrow(() => run(k, s), JSON.stringify(s.slice(0, 20)));
  });
  for (const k of ["trim", "blank", "sort", "join"]) test(`${k} keeps every word`, () => {
    const s = "b  \n\na \n  c\n";
    const o = run(k, s);
    for (const w of ["a", "b", "c"]) assert.ok(o.includes(w), w);
  });
});

describe("clean up is stable when applied twice", () => {
  for (const k of ["trim", "blank", "sort", "dedupe", "lo", "up", "join"]) test(k, () => {
    for (const s of hard) assert.equal(run(k, run(k, s)), run(k, s), JSON.stringify(s.slice(0, 20)));
  });
});

describe("indent and outdent", () => {
  test("outdent undoes indent", () => {
    for (const L of [["a"], ["a", "", "b"], ["• a", "  ◦ b"], ["1. x"]]) assert.deepEqual(LINES.out(LINES.in(L)), L);
  });
  test("empty selection is safe", () => {
    assert.deepEqual(LINES.in([]), []); assert.deepEqual(LINES.out([]), []);
  });
});

describe("list continuation", () => {
  const get = l => n => l[n - 1];
  test("non-list line is left to the editor", () => assert.equal(continueList("hello", "", get(["hello"]), 1), null));
  test("empty item ends the list", () => assert.deepEqual(continueList("- ", "", get(["- "]), 1), { cut: true }));
  test("numbers count up", () => assert.deepEqual(continueList("9. a", "", get(["9. a"]), 1), { insert: "\n10. " }));
  test("indent is kept", () => assert.deepEqual(continueList("  - a", "", get(["  - a"]), 1), { insert: "\n  - " }));
  test("checkbox continues unchecked", () => assert.deepEqual(continueList("[x] a", "", get(["[x] a"]), 1), { insert: "\n[ ] " }));
});

describe("insert buttons only add text", () => {
  for (const [k, v] of Object.entries(INSERT)) test(k, () => assert.ok(typeof v === "string" && v.length > 0 && !/\p{Cn}/u.test(v)));
});
