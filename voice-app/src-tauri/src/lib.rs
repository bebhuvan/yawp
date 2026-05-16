#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // On Linux, WebKitGTK denies media (microphone, etc.) permissions
            // unless the app explicitly grants them. Since this is a local-only
            // dictation app, we auto-allow every permission request from the
            // app's own webview.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                use webkit2gtk::{PermissionRequestExt, WebViewExt};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        let wv = webview.inner();
                        wv.connect_permission_request(|_, request| {
                            request.allow();
                            true
                        });
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
