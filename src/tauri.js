export * as fs from "@tauri-apps/plugin-fs";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { join } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
export const dialog = { open, ask };
export const path = { join };
export const opener = { revealItemInDir };
export const os = { platform };
