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
    //  - WEBKIT_DISABLE_COMPOSITING_MODE was previously set here to prevent
    //    WebKitGTK from losing its backing buffer on occlusion/sleep. It was
    //    removed because forcing software rendering caused the GTK main loop to
    //    block for hundreds of milliseconds on every focus-in (queue_resize on
    //    a software-rendered page), making the app appear frozen on every click.
    //    With GPU compositing enabled, focus-in repaints are a cheap GPU blit.
    //    If backing-buffer loss reappears, the force_repaint on show_main_window
    //    and the async queue_draw on Focused(true) handle recovery.
    //  - GDK_BACKEND=x11: the GTK/WebKit Wayland backend crashes under Tauri
    //    (tauri#8541); force X11/XWayland everywhere, as Handy does.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
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
                // On focus-in, ask WebKit to reblit its existing GPU surface.
                // queue_draw() alone is sufficient here — with GPU compositing
                // the backing texture survives normal occlusion, so this is a
                // cheap blit rather than a full re-layout. We still do the
                // heavier force_repaint (queue_resize + queue_draw) in
                // show_main_window for the tray-restore path where the GTK
                // widget was truly unmapped and the surface may be stale.
                tauri::WindowEvent::Focused(true) => {
                    let handle = window.app_handle().clone();
                    let label = window.label().to_string();
                    tauri::async_runtime::spawn(async move {
                        if let Some(w) = handle.get_webview_window(&label) {
                            light_repaint(&w);
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

// Full repaint — forces a fresh size-allocate so WebKit re-renders from
// scratch. Use this after the window was truly unmapped (tray restore, initial
// show) where the GPU surface may have been discarded.
#[cfg(target_os = "linux")]
fn force_repaint<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use gtk::prelude::WidgetExt;
    let _ = window.with_webview(|webview| {
        let wv = webview.inner();
        wv.queue_resize();
        wv.queue_draw();
    });
}

#[cfg(not(target_os = "linux"))]
fn force_repaint<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

// Lightweight repaint — reblits WebKit's existing GPU surface. With GPU
// compositing the texture survives normal focus changes, so this is just a
// cheap blit with no re-layout. Used on every focus-in event to avoid
// blocking the GTK main loop with an expensive queue_resize.
#[cfg(target_os = "linux")]
fn light_repaint<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use gtk::prelude::WidgetExt;
    let _ = window.with_webview(|webview| {
        webview.inner().queue_draw();
    });
}

#[cfg(not(target_os = "linux"))]
fn light_repaint<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

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
