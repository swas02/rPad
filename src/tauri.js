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
export const pin = on => getCurrentWindow().setAlwaysOnTop(on).catch(() => {});
export const dialog = { open, ask };
export const path = { join };
export const opener = { revealItemInDir };
export const os = { platform };
