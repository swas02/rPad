use std::io::{IsTerminal, Read, Write};
use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// All file access goes through the official Tauri plugins. The dialog plugin adds each folder you pick to the fs scope,
// and persisted-scope remembers those folders between runs, so the page can only touch folders you chose.
pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // --version and --help print and exit; this runs before single-instance, so they never reach the running window
    if let Some(t) = args.iter().find_map(|a| match a.as_str() {
        "--version" | "-V" => Some(format!("rPad {}
", env!("CARGO_PKG_VERSION"))),
        "--help" | "-h" => Some(HELP.to_string()),
        _ => None,
    }) { return say(&t) }
    // `-` reads the text of stdin here, in the process that was started, because a second start cannot send its stdin to the
    // running window. The text waits in a temp file; queue() reads and removes it.
    if args.iter().any(|a| a == "-") && !std::io::stdin().is_terminal() {
        let mut t = String::new();
        if std::io::stdin().read_to_string(&mut t).is_ok() { let _ = std::fs::write(stdin_file(), t); }
    }
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

const HELP: &str = "rPad: a plain-text notepad

Usage: rpad [options] [path[:line[:col]]]...

  <file>           open the file in place
  <folder>         add the folder to the Library and select it
  file:line:col    open the file and go to the line (and column)
  -                new note with the text from stdin (cat a.txt | rpad -)
  -n, --new        new empty note
  -V, --version    print the version
  -h, --help       print this help

If rPad is already open, the paths go to the running window.
";

// The temp file that carries stdin from the started process to queue()
fn stdin_file() -> std::path::PathBuf { std::env::temp_dir().join("rpad-stdin.txt") }

// rPad is a window app, so on Windows it has no console of its own: it uses the console of the shell that started it.
fn say(t: &str) {
    #[cfg(windows)]
    {
        use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
        unsafe { let _ = AttachConsole(ATTACH_PARENT_PROCESS); }
        if let Ok(mut c) = std::fs::OpenOptions::new().write(true).open("CONOUT$") { let _ = c.write_all(t.as_bytes()); return }
    }
    let _ = std::io::stdout().write_all(t.as_bytes());
}

// \\?\C:\a.txt gives C:\a.txt (a network path, \\?\UNC\..., stays as it is)
fn plain_path(p: std::path::PathBuf) -> std::path::PathBuf {
    match p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(r) if r.as_bytes().get(1) == Some(&b':') => std::path::PathBuf::from(r),
        _ => p,
    }
}

// "file:12" or "file:12:5" gives (file, Some(12), Some(5)). Only used when the whole argument is not a path (a Windows path has no number).
fn split_pos(a: &str) -> (&str, Option<u32>, Option<u32>) {
    let num = |s: &str| s.parse::<u32>().ok();
    let cut = |s: &str| s.rsplit_once(':').and_then(|(r, n)| num(n).map(|n| (r.len(), n)));
    if let Some((end, n)) = cut(a) {
        let r = &a[..end];
        if let Some((end2, n2)) = cut(r) { return (&r[..end2], Some(n2), Some(n)) }
        return (r, Some(n), None)
    }
    (a, None, None)
}

// Files and folders from the command line or the shell, waiting for the page: {"kind": "file" | "folder", "path": "..."}
struct Pending(Mutex<Vec<serde_json::Value>>);

// Turns each argument into a full path (a relative path starts at cwd), keeps only paths that exist, and gives the page access:
// a folder gets access to its files (not its subfolders), a file gets access to its folder. Then it tells the page ("open-paths").
// --new and - (stdin) are options; other options (-x, --x) are ignored, so a later version can add them without breaking old scripts.
fn queue(app: &tauri::AppHandle, args: impl IntoIterator<Item = impl AsRef<str>>, cwd: &Path) {
    use tauri_plugin_fs::FsExt;
    let mut items = vec![];
    for a in args {
        let a = a.as_ref();
        match a {
            "--new" | "-n" => items.push(serde_json::json!({ "kind": "new" })),
            "-" => if let Ok(t) = std::fs::read_to_string(stdin_file()) { let _ = std::fs::remove_file(stdin_file()); items.push(serde_json::json!({ "kind": "text", "text": t })) },
            _ if a.is_empty() || a.starts_with('-') => {}
            _ => {
                // cwd.join keeps an absolute argument as it is; std::path::absolute cleans the path and adds no \?\ prefix
                // canonicalize gives the real spelling (letter case, long names, no . or ..), so one file always has one path.
                // It adds a \\?\ prefix on Windows, which plain_path removes. A path that cannot be resolved is only cleaned.
                let abs = |n: &str| { let j = cwd.join(n); std::fs::canonicalize(&j).map(plain_path).or_else(|_| std::path::absolute(&j)) };
                let (full, line, col) = match abs(a) {
                    Ok(p) if p.exists() => (p, None, None),
                    _ => { let (n, l, c) = split_pos(a); match abs(n) { Ok(p) if l.is_some() && p.exists() => (p, l, c), _ => { items.push(serde_json::json!({ "kind": "missing", "path": a })); continue } } }
                };
                // only real files and folders: a device name (CON, NUL, COM1) exists but would block the read
                let (kind, dir) = if full.is_dir() { ("folder", Some(full.as_path())) } else if full.is_file() { ("file", full.parent()) } else { items.push(serde_json::json!({ "kind": "missing", "path": a })); continue };
                if dir.is_some_and(|d| app.fs_scope().allow_directory(d, false).is_ok()) {
                    items.push(serde_json::json!({ "kind": kind, "path": full.to_string_lossy(), "line": line, "col": col }));
                }
            }
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

#[cfg(test)]
mod tests {
    use super::split_pos;
    #[test]
    fn file_line_col() {
        assert_eq!(split_pos("a.txt:5:3"), ("a.txt", Some(5), Some(3)));
        assert_eq!(split_pos("a.txt:5"), ("a.txt", Some(5), None));
        assert_eq!(split_pos(r"C:\a.txt:12"), (r"C:\a.txt", Some(12), None));
        assert_eq!(split_pos(r"C:\a.txt"), (r"C:\a.txt", None, None));
        assert_eq!(split_pos("a.txt"), ("a.txt", None, None));
    }
}
