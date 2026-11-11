use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// All file access goes through the official Tauri plugins. The dialog plugin adds each folder you pick to the fs scope,
// and persisted-scope remembers those folders between runs, so the page can only touch folders you chose.
pub fn run() {
    tauri::Builder::default()
        // Open API, one path for every way to start rPad: `rpad file.txt folder`, "Open with" and double-click in Explorer.
        // A second start does not open a second app: it sends its arguments to the running one and exits (single-instance).
        // It must be the first plugin.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue(app, args.iter().skip(1), Path::new(&cwd));
            if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(Caption(Mutex::new(None)))
        .manage(Pending(Mutex::new(vec![])))
        .setup(|app| {
            // the arguments of this start; the page is not ready yet, so they wait in Pending until the page calls take_open
            queue(app.handle(), std::env::args().skip(1), &std::env::current_dir().unwrap_or_default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![caption, pick_files, history_add, history_remove, take_open])
        // the window gets or loses focus: paint the title bar again (the title text is grey when the window is not active)
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Focused(f) = e {
                if let Some(c) = *w.state::<Caption>().0.lock().unwrap() { paint(w, c, *f) }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running rPad");
}

// Files and folders from the command line or the shell, waiting for the page: {"kind": "file" | "folder", "path": "..."}
struct Pending(Mutex<Vec<serde_json::Value>>);

// Turns each argument into a full path (a relative path starts at cwd), keeps only paths that exist, and gives the page access:
// a folder gets access to its files (not its subfolders), a file gets access to its folder. Then it tells the page ("open-paths").
// Options (-x, --x) are ignored, so a later version can add them without breaking old scripts.
fn queue(app: &tauri::AppHandle, args: impl IntoIterator<Item = impl AsRef<str>>, cwd: &Path) {
    use tauri_plugin_fs::FsExt;
    let mut items = vec![];
    for a in args.into_iter().filter(|a| !a.as_ref().starts_with('-') && !a.as_ref().is_empty()) {
        let a = a.as_ref();
        // cwd.join keeps an absolute argument as it is; std::path::absolute cleans the path and adds no \?\ prefix
        let Ok(full) = std::path::absolute(cwd.join(a)) else { continue };
        if !full.exists() { continue }
        let (kind, dir) = if full.is_dir() { ("folder", Some(full.as_path())) } else { ("file", full.parent()) };
        if dir.is_some_and(|d| app.fs_scope().allow_directory(d, false).is_ok()) {
            items.push(serde_json::json!({ "kind": kind, "path": full.to_string_lossy() }));
        }
    }
    if items.is_empty() { return }
    app.state::<Pending>().0.lock().unwrap().extend(items);
    let _ = app.emit("open-paths", ());
}

// The page asks for the waiting paths (at start, and each time it gets "open-paths"). The list is empty after this call.
#[tauri::command]
fn take_open(state: tauri::State<Pending>) -> Vec<serde_json::Value> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

// Open file: the native dialog, then the folder of each picked file joins the fs scope (without subfolders), so the file
// opens in place and saves back to the same file. Only folders of files the user picked get access; the page cannot name a folder.
// The picked file must stay in the Library under its folder, like a file from "Open folder". persisted-scope keeps the access.
#[tauri::command]
async fn pick_files(app: tauri::AppHandle, window: tauri::Window) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    use tauri_plugin_fs::FsExt;
    let Some(fs) = app.dialog().file().set_title("Open file").set_parent(&window).blocking_pick_files() else { return vec![] };
    fs.into_iter().filter_map(|f| f.into_path().ok()).filter(|p| p.parent().is_some_and(|d| app.fs_scope().allow_directory(d, false).is_ok()))
        .map(|p| p.to_string_lossy().into_owned()).collect()
}

// History file: history.json in the app data folder is one JSON array; each item is the full path of a closed file, split into its parts (newest last).
// It is a separate file, so it stays even if the page storage is cleared. The page cannot choose the file name or the folder.
#[tauri::command]
fn history_add(app: tauri::AppHandle, path: Vec<String>) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("history.json");
    let mut list: Vec<Vec<String>> = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    list.push(path);
    std::fs::write(&file, serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

// Removes entries from history.json when they leave the History panel: one path (every entry with that path), or all entries when no path is given.
#[tauri::command]
fn history_remove(app: tauri::AppHandle, path: Option<Vec<String>>) -> Result<(), String> {
    let file = app.path().app_data_dir().map_err(|e| e.to_string())?.join("history.json");
    let Ok(text) = std::fs::read_to_string(&file) else { return Ok(()) };
    let mut list: Vec<Vec<String>> = serde_json::from_str(&text).unwrap_or_default();
    match path { Some(p) => list.retain(|x| *x != p), None => list.clear() }
    std::fs::write(&file, serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

// the last title bar colour from the page (0xRRGGBB)
struct Caption(Mutex<Option<u32>>);

// Paints the native title bar in the theme colour ("#rrggbb"), so it matches the menu row below it.
#[tauri::command]
fn caption(window: tauri::Window, state: tauri::State<Caption>, color: String) {
    let Some(c) = color.strip_prefix('#').filter(|h| h.len() == 6).and_then(|h| u32::from_str_radix(h, 16).ok()) else { return };
    *state.0.lock().unwrap() = Some(c);
    paint(&window, c, window.is_focused().unwrap_or(true));
}

// Tauri's set_theme makes the caption buttons light or dark; the DWM attributes set the bar, border and title colour.
// Windows 11 only: Windows 10 rejects these attributes and the bar keeps its default colour.
fn paint(window: &tauri::Window, c: u32, active: bool) {
    let (r, g, b) = (c >> 16 & 255, c >> 8 & 255, c & 255);
    let light = r * 299 + g * 587 + b * 114 > 128_000;
    let _ = window.set_theme(Some(if light { tauri::Theme::Light } else { tauri::Theme::Dark }));
    #[cfg(windows)]
    {
        use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR};
        let Ok(hwnd) = window.hwnd() else { return };
        let bg = r | g << 8 | b << 16; // COLORREF is 0x00BBGGRR
        let fg: u32 = match (light, active) { (true, true) => 0x000000, (false, true) => 0xFFFFFF, (true, false) => 0x7A7A7A, (false, false) => 0x8C8C8C };
        for (a, v) in [(DWMWA_CAPTION_COLOR, bg), (DWMWA_BORDER_COLOR, bg), (DWMWA_TEXT_COLOR, fg)] {
            unsafe { let _ = DwmSetWindowAttribute(hwnd, a, &v as *const u32 as _, 4); }
        }
    }
}
