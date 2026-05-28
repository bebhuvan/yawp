// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Renderer workarounds (e.g. WEBKIT_DISABLE_DMABUF_RENDERER) live in
    // voice_app_lib::run(), the single entry point shared by desktop and
    // mobile, so every launch path applies them identically.
    voice_app_lib::run()
}
