// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ofd;

/// Open an OFD document from base64-encoded bytes (sent by the webview).
#[tauri::command]
fn open_ofd(bytes_b64: String) -> Result<ofd::OfdPackage, String> {
    ofd::open_from_b64(&bytes_b64)
}

/// Open an OFD document directly from a filesystem path (dialog / drag & drop).
#[tauri::command]
fn open_ofd_path(path: String) -> Result<ofd::OfdPackage, String> {
    ofd::open_from_path(&path)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_ofd, open_ofd_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
