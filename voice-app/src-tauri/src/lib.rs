#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!(
            "Yawp - local-first voice dictation\n\n\
Usage: yawp [OPTIONS]\n\n\
Options:\n  \
--start-hidden    Start without showing the main window\n  \
--no-tray         Do not create a system tray icon\n  \
--debug           Enable verbose app startup logging\n  \
--help, -h        Print help\n\n\
Runtime control:\n  \
Use the installed `yawp` CLI for daemon control: status, doctor, toggle-notes,\n  \
toggle-paste, cancel, reload, restart, and logs."
        );
        return;
    }
    let no_tray = args.iter().any(|arg| arg == "--no-tray");
    let requested_start_hidden = args.iter().any(|arg| arg == "--start-hidden");
    let start_hidden = requested_start_hidden && !no_tray;
    let debug = args.iter().any(|arg| arg == "--debug");
    if debug {
        eprintln!("Yawp debug startup: args={args:?}");
        if requested_start_hidden && no_tray {
            eprintln!("Yawp debug startup: ignoring --start-hidden because --no-tray is set");
        }
    }

    // WebKitGTK reliability knobs, set before the webview is created so every
    // launch path (.deb, AppImage, dev) gets them.
    //
    //  - WEBKIT_DISABLE_DMABUF_RENDERER: the DMA-BUF renderer crashes / shows a
    //    blank surface on various GPU/display-server stacks. Disabling it is the
    //    one mitigation the sibling Handy app ships (tauri#9394) and it keeps
    //    accelerated compositing intact.
    //  - WEBKIT_DISABLE_COMPOSITING_MODE: additionally route WebKit through the
    //    non-composited paint path, which doesn't lose its backing buffer when
    //    the window is occluded / the display sleeps on Intel/Mesa + X11. Handy
    //    does NOT need this (it bundles its own older WebKitGTK + a patched Tauri
    //    runtime); we run against the system WebKitGTK, where 2.52.x regresses,
    //    so we keep it until we bundle a known-good WebKit.
    //  - GDK_BACKEND=x11: the GTK/WebKit Wayland backend crashes under Tauri
    //    (tauri#8541); force X11/XWayland everywhere, as Handy does.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .on_window_event(move |window, event| {
            use tauri::Manager;
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } if !no_tray => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // Regaining focus is the moment the user comes back to a window
                // that may have been hidden or sat behind a sleeping display —
                // exactly when WebKitGTK is prone to showing a stale black
                // surface. Schedule the repaint asynchronously so it does NOT
                // block the focus-in event on the GTK main thread: with
                // WEBKIT_DISABLE_COMPOSITING_MODE=1 the software-render path
                // in WebKitGTK 2.52 blocks the GTK main loop until the full
                // page repaint completes, which causes an apparent freeze on
                // every click that brings the window to focus.
                tauri::WindowEvent::Focused(true) => {
                    let handle = window.app_handle().clone();
                    let label = window.label().to_string();
                    tauri::async_runtime::spawn(async move {
                        if let Some(w) = handle.get_webview_window(&label) {
                            force_repaint(&w);
                        }
                    });
                }
                _ => {}
            }
        })
        .setup(move |app| {
            // On Linux, WebKitGTK denies media (microphone, etc.) permissions
            // unless the app explicitly grants them. Since this is a local-only
            // dictation app, we auto-allow every permission request from the
            // app's own webview.
            use tauri::{Listener, Manager};

            if !no_tray {
                let tray = build_tray(app)?;
                app.manage(tray);
            }

            // The window starts hidden (`visible: false` in tauri.conf.json) so
            // users never see WebKitGTK's black pre-paint surface. Unless the
            // user asked to start in the tray, reveal it once the frontend
            // signals its first frame is painted ("app-ready").
            if !start_hidden {
                let ready_handle = app.handle().clone();
                app.once_any("app-ready", move |_event| {
                    if let Some(window) = ready_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        force_repaint(&window);
                    }
                });

                // Safety net: if the frontend never loads (and so never sends
                // "app-ready"), show the window anyway so it can't get stuck
                // invisible with no way to reach it.
                let fallback_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    if let Some(window) = fallback_handle.get_webview_window("main") {
                        if !window.is_visible().unwrap_or(true) {
                            let _ = window.show();
                            force_repaint(&window);
                        }
                    }
                });
            }

            #[cfg(target_os = "linux")]
            {
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

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        force_repaint(&window);
    }
}

// Force WebKitGTK to re-render the page. After the window has been hidden to
// the tray or the display has slept, the GTK widget can keep a stale (black)
// backing buffer until something invalidates it; queueing a resize makes
// WebKit re-allocate and repaint without any visible window resize. No-op on
// platforms where this class of stale-buffer bug doesn't occur.
#[cfg(target_os = "linux")]
fn force_repaint<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use gtk::prelude::WidgetExt;
    // `queue_draw()` alone only re-blits WebKit's existing backing buffer — when
    // that buffer was discarded on occlusion/display-sleep it just re-shows the
    // stale (black) surface. `queue_resize()` forces a fresh size-allocate on the
    // webview widget, which makes WebKit re-render from scratch. It does NOT
    // resize the OS window (no WM round-trip), so it avoids the hangs an actual
    // `gtk_window_resize` toggle caused. Belt-and-braces with a draw afterwards.
    let _ = window.with_webview(|webview| {
        let wv = webview.inner();
        wv.queue_resize();
        wv.queue_draw();
    });
}

#[cfg(not(target_os = "linux"))]
fn force_repaint<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

fn build_tray<R, M>(manager: &M) -> tauri::Result<tauri::tray::TrayIcon<R>>
where
    R: tauri::Runtime,
    M: tauri::Manager<R>,
{
    use tauri::menu::MenuBuilder;
    use tauri::tray::TrayIconBuilder;

    const MENU_SHOW: &str = "yawp-show";
    const MENU_HIDE: &str = "yawp-hide";
    const MENU_QUIT: &str = "yawp-quit";

    let menu = MenuBuilder::new(manager)
        .text(MENU_SHOW, "Show Yawp")
        .text(MENU_HIDE, "Hide Window")
        .separator()
        .text(MENU_QUIT, "Quit")
        .build()?;

    let mut builder = TrayIconBuilder::with_id("yawp-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Yawp")
        .on_menu_event(
            |app, event: tauri::menu::MenuEvent| match event.id().as_ref() {
                MENU_SHOW => show_main_window(app),
                MENU_HIDE => {
                    use tauri::Manager;
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                MENU_QUIT => app.exit(0),
                _ => {}
            },
        );

    if let Some(icon) = manager.app_handle().default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(manager)
}
