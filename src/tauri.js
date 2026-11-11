export * as fs from "@tauri-apps/plugin-fs";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
// paint the native title bar in this colour (#rrggbb); see caption() in src-tauri/src/lib.rs
export const caption = color => invoke("caption", { color }).catch(() => {});
// window title (also shown on the taskbar and in Alt+Tab) and "Keep on top"
export const title = s => getCurrentWindow().setTitle(s).catch(() => {});
// show the window, which starts hidden (tauri.conf.json "visible": false) so the page is drawn first; see bootDone() in src/themes.js
export const reveal = () => { const w = getCurrentWindow(); w.show().then(() => w.setFocus()).catch(() => {}) };
export const pin = on => getCurrentWindow().setAlwaysOnTop(on).catch(() => {});
// Open file: full paths of the picked files; their folders get access (see pick_files() in src-tauri/src/lib.rs)
export const pickFiles = () => invoke("pick_files");
// History file: add one closed file (its full path); see history_add() in src-tauri/src/lib.rs
// no path: clear the whole file; a path: remove every entry with that path
export const unlogClosed = path => invoke("history_remove", { path: path || null }).catch(() => {});
export const logClosed = path => invoke("history_add", { path }).catch(() => {});
export const dialog = { open, ask };
export const path = { join };
export const opener = { revealItemInDir };
export const os = { platform };
