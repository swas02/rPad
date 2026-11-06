use std::sync::Mutex;
use tauri::Manager;

// All file access goes through the official Tauri plugins. The dialog plugin adds each folder you pick to the fs scope,
// and persisted-scope remembers those folders between runs, so the page can only touch folders you chose.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(Caption(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![caption])
        // the window gets or loses focus: paint the title bar again (the title text is grey when the window is not active)
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Focused(f) = e {
                if let Some(c) = *w.state::<Caption>().0.lock().unwrap() { paint(w, c, *f) }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running rPad");
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
