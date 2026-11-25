use crate::{
    native::{self, Approved, Manual},
    session::{self, Session, Sessions},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use polar::catalog::{Item, Registration, Report};
use serde::Serialize;
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct Data {
    pub known: Mutex<HashMap<String, Item>>,
    pub writes: Mutex<()>,
    pub pending: Mutex<Option<Manual>>,
}
fn file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("shortcuts.json"))
        .map_err(|e| e.to_string())
}
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn discover(app: AppHandle, source: String) -> Result<Report, String> {
    blocking(move || {
        if source == "manual" {
            let entries = native::read_manual(&file(&app)?)?;
            return Ok(Report {
                items: entries.iter().map(Manual::display).collect(),
                ..Report::ok()
            });
        }
        if !["steam", "epic", "xbox"].contains(&source.as_str()) {
            return Err("source".into());
        }
        let report = native::source(&source);
        let state = app.state::<Data>();
        let mut known = state.known.lock().unwrap();
        if report.complete {
            known.retain(|_, x| x.source != source)
        }
        known.extend(report.items.iter().map(|g| (g.id.clone(), g.clone())));
        Ok(report)
    })
    .await
}

#[tauri::command]
pub async fn artwork(app: AppHandle, id: String, hero: bool) -> Result<Option<String>, String> {
    blocking(move || {
        let state = app.state::<Data>();
        let path = state.known.lock().unwrap().get(&id).and_then(|g| {
            if hero {
                g.hero.clone().or(g.cover.clone())
            } else {
                g.cover.clone()
            }
        });
        let Some(path) = path else { return Ok(None) };
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        let mime = if bytes.starts_with(&[255, 216, 255]) {
            "jpeg"
        } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "png"
        } else {
            return Ok(None);
        };
        if bytes.len() > 4 * 1024 * 1024 {
            return Ok(None);
        }
        Ok(Some(format!(
            "data:image/{mime};base64,{}",
            STANDARD.encode(bytes)
        )))
    })
    .await
}

#[tauri::command]
pub async fn registered_apps() -> Result<Vec<Registration>, String> {
    blocking(|| native::registrations(false)).await
}
#[tauri::command]
pub async fn pick_shortcut(app: AppHandle) -> Result<Option<Item>, String> {
    blocking(move || {
        let owner = app
            .get_webview_window("main")
            .ok_or("window")?
            .hwnd()
            .map_err(|e| e.to_string())?;
        let Some(path) = native::pick_link(owner.0)? else {
            return Ok(None);
        };
        let (id, _) = native::shortcut(&path)?;
        let name = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let item = Manual {
            id,
            name,
            source: "manual".into(),
            approved: Approved::Shortcut(path),
        };
        let display = item.display();
        *app.state::<Data>().pending.lock().unwrap() = Some(item);
        Ok(Some(display))
    })
    .await
}
#[tauri::command]
pub async fn save_manual(
    app: AppHandle,
    id: String,
    name: String,
    source: String,
    kind: String,
    previous: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        if name.trim().is_empty()
            || name.len() > 512
            || name.chars().any(char::is_control)
            || !["manual", "steam", "epic", "xbox"].contains(&source.as_str())
        {
            return Err("details".into());
        }
        let state = app.state::<Data>();
        let mut entry = match kind.as_str() {
            "app" => {
                let row = native::registrations(false)?
                    .into_iter()
                    .find(|r| r.id == id)
                    .ok_or("missing")?;
                Manual {
                    id: format!("xbox:{}", row.id),
                    name: row.name,
                    source: source.clone(),
                    approved: Approved::App(row.id),
                }
            }
            "shortcut" => state
                .pending
                .lock()
                .unwrap()
                .clone()
                .filter(|m| m.id == id)
                .ok_or("selection")?,
            _ => return Err("selection".into()),
        };
        entry.name = name.trim().into();
        entry.source = source;
        let _guard = state.writes.lock().unwrap();
        let file = file(&app)?;
        let mut items = native::read_manual(&file)?;
        items.retain(|m| m.id != entry.id && previous.as_ref() != Some(&m.id));
        items.push(entry);
        native::write_manual(&file, &items)?;
        if kind == "shortcut" {
            state.pending.lock().unwrap().take();
        }
        Ok(())
    })
    .await
}
#[tauri::command]
pub fn remove_manual(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<Data>();
    let _guard = state.writes.lock().unwrap();
    let file = file(&app)?;
    let mut items = native::read_manual(&file)?;
    items.retain(|m| m.id != id);
    native::write_manual(&file, &items)
}
#[tauri::command]
pub async fn launch_game(app: AppHandle, id: String) -> Result<(), String> {
    let serial = app.state::<Sessions>().start(&id)?;
    let worker = app.clone();
    let outcome = blocking(move || {
        let source = id.split(':').next().unwrap_or("");
        let item = if ["steam", "xbox", "epic"].contains(&source) {
            native::source(source)
                .items
                .into_iter()
                .find(|g| g.id == id)
        } else {
            None
        };
        let (target, root) = if let Some(game) = item {
            (game.target, Some(game.root))
        } else {
            let entry = native::read_manual(&file(&worker)?)?
                .into_iter()
                .find(|m| m.id == id)
                .ok_or("missing")?;
            let target = match entry.approved {
                Approved::Shortcut(path) => {
                    let (current, target) = native::shortcut(&path)?;
                    if current != entry.id {
                        return Err("changed".into());
                    }
                    target
                }
                Approved::App(id) => {
                    if !native::registrations(false)?.iter().any(|r| r.id == id) {
                        return Err("missing".into());
                    }
                    format!("shell:AppsFolder\\{id}")
                }
            };
            (target, None)
        };
        let before = session::visible();
        native::shell(target.as_ref())?;
        let state = worker.state::<Sessions>();
        if let Some(root) = root {
            state.phase(serial, "waiting");
            std::thread::spawn(move || session::monitor(worker, serial, root, before));
        } else {
            state.phase(serial, "unknown")
        }
        Ok(())
    })
    .await;
    if outcome.is_err() {
        app.state::<Sessions>().phase(serial, "failed")
    }
    outcome
}
#[tauri::command]
pub fn get_session(s: State<'_, Sessions>) -> Session {
    s.snapshot()
}
#[derive(Serialize)]
pub struct Options {
    fullscreen: bool,
    login: bool,
}
#[tauri::command]
pub fn get_options(window: tauri::WebviewWindow) -> Result<Options, String> {
    Ok(Options {
        fullscreen: window.is_fullscreen().map_err(|e| e.to_string())?,
        login: native::login()?,
    })
}
#[tauri::command]
pub fn window_action(
    window: tauri::WebviewWindow,
    action: String,
    enabled: bool,
) -> Result<(), String> {
    match action.as_str() {
        "fullscreen" => window.set_fullscreen(enabled),
        "desktop" => window.minimize(),
        "quit" => window.close(),
        "login" => return native::set_login(enabled),
        _ => return Err("action".into()),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_platform(source: String) -> Result<(), String> {
    let target = match source.as_str() {
        "steam" => "steam://open/games",
        "epic" => "com.epicgames.launcher://library",
        "xbox" => r"shell:AppsFolder\Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App",
        _ => return Err("source".into()),
    };
    native::shell(target.as_ref())
}
