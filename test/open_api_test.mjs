// Open API: `rpad <file|folder>`, "Open with" and double-click must reach the page.
// Checks the contract between the config, Rust, tauri.js and the page (not how each is built).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8").replace(/^﻿/, "");
const rust = read("src-tauri/src/lib.rs"), tauri = read("src/tauri.js"), html = read("index.html");
const conf = JSON.parse(read("src-tauri/tauri.conf.json")), cap = JSON.parse(read("src-tauri/capabilities/default.json"));

describe("Open API", () => {
  test("a second start goes to the running window (single-instance is the first plugin)", () => {
    assert.match(read("src-tauri/Cargo.toml"), /tauri-plugin-single-instance/);
    assert.ok(rust.indexOf("single_instance") < rust.indexOf("tauri_plugin_dialog::init"));
  });
  test("windows can list rPad in Open with: file associations are set for plain text", () => {
    const a = conf.bundle.fileAssociations; assert.ok(a?.length);
    assert.ok(a[0].ext.includes("txt") && a[0].ext.includes("md"));
  });
  test("start arguments are read at launch and in a later start", () => {
    assert.match(rust, /std::env::args\(\)/);
    assert.match(rust, /take_open/);
    assert.match(rust, /generate_handler!\[[^\]]*take_open/);
  });
  test("the page can listen to the event", () => {
    assert.ok(cap.permissions.includes("core:event:allow-listen"));
    assert.match(tauri, /export const onOpen\b/);
    assert.match(tauri, /take_open/);
  });
  test("the page opens files and folders from the API", () => {
    assert.match(html, /TAU\.onOpen\(/);
    assert.match(html, /function dArgs/);
  });
  test("Open file and the API share one function", () => assert.match(html, /function dFiles/));
});

describe("Open API options", () => {
  test("--new, - (stdin), file:line, --version and --help are handled in Rust", () => {
    for (const w of ['"--new"', '"-"', "split_pos", '"--version"', '"--help"']) assert.ok(rust.includes(w), w);
  });
  test("the page opens a new note and goes to a line", () => {
    assert.match(html, /x\.kind === "new"/);
    assert.match(html, /ed\.goto\(/);
    assert.match(read("src/editor.js"), /goto\(line/);
  });
  test("the installer adds rPad to PATH", () => {
    assert.equal(conf.bundle.windows.nsis.installerHooks, "installer-hooks.nsh");
    assert.match(read("src-tauri/installer-hooks.nsh"), /HKCU "Environment" "Path"/);
  });
});

