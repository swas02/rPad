// All file access goes through the official Tauri plugins. The dialog plugin adds each folder you pick to the fs scope,
// and persisted-scope remembers those folders between runs, so the page can only touch folders you chose.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .run(tauri::generate_context!())
        .expect("error while running rPad");
}
