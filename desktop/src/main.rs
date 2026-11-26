#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
#[cfg(windows)]
mod commands;
#[cfg(windows)]
mod native;
#[cfg(windows)]
mod session;
#[cfg(windows)]
fn main() {
    use commands::*;
    use tauri::Manager;
    tauri::Builder::default()
        .plugin(
            tauri::plugin::Builder::<_, ()>::new("local-navigation")
                .on_navigation(|_, url| {
                    matches!(url.scheme(), "http" | "https")
                        && url.host_str() == Some("tauri.localhost")
                        && url.port().is_none()
                        || url.scheme() == "tauri"
                            && url.host_str() == Some("localhost")
                            && url.port().is_none()
                        || url.as_str() == "about:blank"
                })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            // Reveal the window even if WebView initialization fails before its ready signal.
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if !handle
                    .state::<Data>()
                    .presented
                    .load(std::sync::atomic::Ordering::Acquire)
                    && let Some(window) = handle.get_webview_window("main")
                {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .manage(Data::default())
        .manage(session::Sessions::default())
        .invoke_handler(tauri::generate_handler![
            discover,
            epic_folders,
            online_cover,
            epic_cover,
            artwork,
            search_backgrounds,
            online_background,
            launch_game,
            get_session,
            registered_apps,
            open_platform,
            pick_shortcut,
            save_manual,
            remove_manual,
            get_options,
            window_action
        ])
        .run(tauri::generate_context!())
        .expect("Polar desktop runtime");
}
#[cfg(not(windows))]
fn main() {
    eprintln!("Polar desktop requires Windows 11.")
}
