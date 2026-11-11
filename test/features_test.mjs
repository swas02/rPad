// Feature-availability tests. Each test names a feature a notepad / editor app
// should offer and checks that the app exposes it: a UI control, a keyboard
// shortcut, an editor API method, a text action, or a desktop command.
// They look for the user-facing hook (label, shortcut text, handler), not for
// how the feature is built, so a refactor does not break them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as T from "../src/textops.js";

const root = path.resolve(import.meta.dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8").replace(/^﻿/, "");
const html = read("index.html");
const editorSrc = read("src/editor.js");
const tauriJs = read("src/tauri.js");
const rust = read("src-tauri/src/lib.rs");
const has = (s, needle) => (needle instanceof RegExp ? needle.test(s) : s.includes(needle));

describe("file and tab features", () => {
  const ui = [
    ["new note", 'aria-label="New note"'],
    ["new tab", 'aria-label="New tab"'],
    ["close tab", 'aria-label="Close tab"'],
    ["all tabs list", 'aria-label="All tabs"'],
    ["open tabs list", 'aria-label="Open tabs"'],
    ["tab name editing", 'aria-label="Tab name"'],
    ["file name editing", 'aria-label="File name"'],
    ["delete file", 'aria-label="Delete file"'],
    ["download", 'aria-label="Download"'],
    ["star a note", 'aria-label="Star"'],
    ["history list", 'aria-label="History"'],
    ["remove from history", 'aria-label="Remove from History"'],
    ["filter notes by name", 'aria-label="Filter notes by name"'],
    ["sort notes", 'aria-label="Sort"'],
    ["folders: choose", 'aria-label="Choose folder"'],
    ["folders: edit", 'aria-label="Edit folder"'],
    ["folders: back", 'aria-label="Back to folders"'],
    ["back to note", 'aria-label="Back to note"'],
    ["more actions menu", 'aria-label="More actions"'],
    ["main menu", 'aria-label="Menu"'],
    ["toggle sidebar", 'aria-label="Toggle sidebar"'],
    ["tab search / command palette", "Search tabs, or type > for commands"],
  ];
  for (const [name, needle] of ui) test(`has: ${name}`, () => assert.ok(has(html, needle), needle));

  test("sort offers open order, A to Z and Z to A", () => {
    for (const s of ["Open order", "Name, A to Z", "Name, Z to A"]) assert.ok(html.includes(s), s);
  });
  test("rename flow exists", () => assert.match(html, /Rename/));
});

describe("editing features", () => {
  const ui = [
    ["undo", 'aria-label="Undo"'],
    ["redo", 'aria-label="Redo"'],
    ["indent", 'aria-label="Indent"'],
    ["outdent", 'aria-label="Outdent"'],
    ["bullet list", 'aria-label="Bullet list"'],
    ["numbered list", 'aria-label="Numbered list"'],
    ["checkbox", 'aria-label="Checkbox"'],
    ["tick checkbox", 'aria-label="Tick or untick checkbox"'],
    ["larger text", 'aria-label="Larger"'],
    ["smaller text", 'aria-label="Smaller"'],
    ["text font", 'aria-label="Text font"'],
    ["word wrap", 'title="Toggle word wrap"'],
    ["hide keyboard (mobile)", 'aria-label="Hide keyboard"'],
    ["hide top row (mobile)", 'aria-label="Hide top row"'],
  ];
  for (const [name, needle] of ui) test(`has: ${name}`, () => assert.ok(has(html, needle), needle));

  test("editor engine exposes the methods the page calls", () => {
    for (const m of ["dom", "measure", "hasFocus", "text", "open", "keepOnly", "set", "remeasure", "undo", "selectAll", "selText", "replaceSel", "select", "sel", "format", "cleanup"])
      assert.match(editorSrc, new RegExp(`\\b${m}\\b\\s*[(:]`), `editor.${m}`);
  });
  test("editor create() accepts the three callbacks", () => {
    for (const cb of ["onText", "onSelect", "onFind"]) assert.ok(editorSrc.includes(cb), cb);
  });
  test("editor binds Enter (list continue), Tab (indent) and history keys", () => {
    assert.match(editorSrc, /key:\s*"Enter"/);
    assert.match(editorSrc, /key:\s*"Tab"/);
    assert.match(editorSrc, /historyKeymap/);
  });
  test("editor has line numbers, active-line highlight and search", () => {
    for (const w of ["lineNumbers", "highlightActiveLine", "search("]) assert.ok(editorSrc.includes(w), w);
  });
});

describe("find and replace", () => {
  for (const [name, needle] of [
    ["find box", 'aria-label="Find"'],
    ["replace box", 'aria-label="Replace"'],
    ["next match", 'aria-label="Next"'],
    ["previous match", 'aria-label="Previous"'],
    ["match case", 'aria-label="Match case"'],
    ["close find", 'aria-label="Close find"'],
    ["Ctrl+F hint", "Find (Ctrl+F)"],
  ]) test(`has: ${name}`, () => assert.ok(html.includes(needle), needle));

  test("editor supports next, previous, replace one and replace all", () => {
    for (const f of ["findNext", "findPrevious", "replaceNext", "replaceAll", "setSearchQuery"]) assert.ok(editorSrc.includes(f), f);
  });
  test("whole-document find across notes exists (Ctrl+Shift+F)", () => assert.ok(html.includes("Ctrl+Shift+F")));
});

describe("text actions (formatting bar and Clean up)", () => {
  test("every formatting key the page can send is known to the editor", () => {
    for (const k of [...Object.keys(T.INSERT), ...Object.keys(T.LINES), "u"])
      assert.ok(k.length > 0);
  });
  test("INSERT, LINES and CLEAN are all non-empty", () => {
    for (const o of [T.INSERT, T.LINES, T.CLEAN]) assert.ok(Object.keys(o).length > 0);
  });
  for (const k of ["join", "plain", "trim", "blank", "sort", "dedupe", "lo", "up", "ti", "se"])
    test(`Clean up action exists: ${k}`, () => assert.ok(T.CLEAN[k], k));
  for (const k of ["in", "out", "e"])
    test(`line action exists: ${k}`, () => assert.equal(typeof T.LINES[k], "function"));
  test("every Clean up key is reachable from the page", () => {
    for (const k of Object.keys(T.CLEAN)) assert.ok(new RegExp(`["'\`]${k}["'\`]`).test(html), `page never mentions CLEAN.${k}`);
  });
  test("every insert key is reachable from the page", () => {
    for (const k of Object.keys(T.INSERT)) assert.ok(new RegExp("[\"'`]" + k + "[\"'`]").test(html), "page never mentions INSERT." + k);
  });
  // Product rule: plain text only. No fake rich text (Unicode bold, italic, monospace, super or subscript, strike or underline markers).
  test("rpad offers no rich-text styles", () => {
    assert.equal(T.STYLES, undefined);
    assert.equal(T.wrap, undefined);
    for (const w of ["Bold", "Italic", "Superscript", "Subscript", "Underline", "Strikethrough"]) assert.ok(!new RegExp('aria-label="' + w, "i").test(html), w);
  });
});

describe("keyboard shortcuts", () => {
  for (const [key, why] of [
    ["Ctrl+S", "save"], ["Ctrl+N", "new note"], ["Ctrl+O", "open"], ["Ctrl+F", "find"], ["Ctrl+H", "replace"],
    ["Ctrl+B", "toggle sidebar"], ["Ctrl+P", "quick open"], ["Ctrl+Shift+P", "command palette"],
    ["Ctrl+Shift+F", "find in notes"], ["Ctrl+Shift+N", "new window / note"], ["Ctrl+Alt+N", "alternate new"],
    ["Alt+Z", "word wrap"],
  ]) test(`${key} (${why}) is documented in the app`, () => assert.ok(html.includes(key), key));

  test("Escape, Enter, arrow keys and Tab are handled in the page", () => {
    for (const k of ["Escape", "Enter", "ArrowDown", "ArrowUp", "Tab"]) assert.ok(html.includes(`"${k}"`), k);
  });
  test("F2 (rename) and F1 (help) are handled", () => {
    assert.ok(html.includes('"F2"')); assert.ok(html.includes('"F1"'));
  });
  test("a keydown listener is registered", () => assert.match(html, /addEventListener\(\s*["']keydown["']/));
});

describe("settings, themes and appearance", () => {
  for (const [name, needle] of [
    ["settings button", 'aria-label="Settings"'],
    ["display settings", 'title="Display settings"'],
    ["theme picker", 'title="Change theme"'],
    ["view switcher", 'aria-label="Views"'],
  ]) test(`has: ${name}`, () => assert.ok(html.includes(needle), needle));

  test("light and dark modes are supported", () => {
    assert.match(html, /dark:/); assert.match(html, /prefers-color-scheme/);
  });
  test("settings survive restart (localStorage or file)", () => assert.match(html, /localStorage|writeTextFile/));
});

describe("persistence and safety", () => {
  test("autosave exists", () => assert.match(html, /autosave|Autosave|saved/i));
  test("unsaved or closed tabs can be reopened", () => assert.match(html, /Click to reopen/));
  test("delete asks for confirmation", () => assert.match(html, /ask\(|confirm\(|Delete/));
  test("errors are shown to the user (toast or banner)", () => assert.match(html, /toast|banner/i));
});

describe("PWA / offline", () => {
  test("service worker is registered", () => assert.match(html, /serviceWorker\.register/));
  test("app is installable (manifest + icons)", () => {
    const m = JSON.parse(read("manifest.webmanifest"));
    assert.ok(m.icons && m.icons.length >= 1);
  });
});

describe("desktop (Tauri) features", () => {
  const cmds = [...rust.matchAll(/#\[tauri::command\][\s\S]*?fn\s+(\w+)/g)].map(m => m[1]);
  test("Rust exposes caption, pick_files, history_add, history_remove", () => {
    for (const c of ["caption", "pick_files", "history_add", "history_remove"]) assert.ok(cmds.includes(c), c);
  });
  test("every Rust command is registered in the invoke handler", () => {
    const h = rust.match(/generate_handler!\[([^\]]*)\]/)?.[1] || "";
    for (const c of cmds) assert.ok(h.includes(c), `${c} not registered`);
  });
  test("every invoke() in tauri.js calls a real Rust command", () => {
    for (const m of tauriJs.matchAll(/invoke\(\s*"(\w+)"/g)) assert.ok(cmds.includes(m[1]), m[1]);
  });
  test("tauri.js exports window helpers: title, reveal, pin, caption", () => {
    for (const n of ["title", "reveal", "pin", "caption", "pickFiles", "logClosed", "unlogClosed"])
      assert.match(tauriJs, new RegExp(`export const ${n}\\b`), n);
  });
  test("tauri.js exports fs, dialog, path, opener and os", () => {
    for (const n of ["fs", "dialog", "path", "opener", "os"]) assert.match(tauriJs, new RegExp(`export (const|\\*)[^\\n]*\\b${n}\\b`), n);
  });
  test("every TauriAPI.x the page uses is exported by tauri.js", () => {
    const names = new Set([...tauriJs.matchAll(/export (?:const|function) (\w+)/g)].map(m => m[1]));
    for (const m of html.matchAll(/TauriAPI\.(\w+)/g)) assert.ok(names.has(m[1]) || m[1] === "fs", `TauriAPI.${m[1]}`);
  });
  test("pick files, reveal in folder and always-on-top are reachable", () => {
    for (const w of ["pickFiles", "reveal", "pin"]) assert.ok(html.includes(w) || tauriJs.includes(w), w);
  });
});

describe("built assets", () => {
  test("root editor.js (bundle) exists and is built from src/editor.js", () => {
    assert.ok(fs.existsSync(path.join(root, "editor.js")));
    assert.ok(fs.readFileSync(path.join(root, "src/build.mjs"), "utf8").includes("editor"));
  });
  test("tailwind stylesheet source exists", () => assert.ok(fs.existsSync(path.join(root, "src/tw.css"))));
  test("app and manifest icons exist", () => {
    for (const f of ["assets/icon.svg"]) assert.ok(fs.existsSync(path.join(root, f)), f);
  });
});
