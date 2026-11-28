//! Unix desktop launcher integrations. The WebView supplies only catalog IDs.
use crate::catalog::{Item, Report};
#[cfg(any(target_os = "linux", test))]
use std::fs;
use std::{
    collections::HashSet,
    env, io,
    path::{Path, PathBuf},
    process::Command,
};

fn home() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .ok_or_else(|| "Home directory unavailable".into())
}

fn merge(report: &mut Report, next: Report, ids: &mut HashSet<String>) {
    report.complete &= next.complete;
    report.warnings.extend(next.warnings);
    report
        .items
        .extend(next.items.into_iter().filter(|g| ids.insert(g.id.clone())));
}

fn steam_libraries(roots: &[PathBuf]) -> Report {
    let mut report = Report::ok();
    let mut ids = HashSet::new();
    let mut seen = HashSet::new();
    for path in roots {
        match path.canonicalize() {
            Ok(root) if seen.insert(root.clone()) => {
                merge(&mut report, crate::catalog::steam_scan_at(&root), &mut ids)
            }
            Err(e) if e.kind() != io::ErrorKind::NotFound => {
                report.complete = false;
                report.warnings.push(format!("{}: {e}", path.display()));
            }
            _ => {}
        }
    }
    report
}

#[cfg(target_os = "linux")]
fn xdg(name: &str, default: PathBuf) -> PathBuf {
    env::var_os(name)
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or(default)
}

#[cfg(target_os = "linux")]
fn steam_roots(home: &Path) -> Vec<PathBuf> {
    vec![
        xdg("XDG_DATA_HOME", home.join(".local/share")).join("Steam"),
        home.join(".steam/steam"),
        home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
        home.join(".var/app/com.valvesoftware.Steam/data/Steam"),
        home.join("snap/steam/common/.local/share/Steam"),
    ]
}

#[cfg(target_os = "macos")]
fn steam_roots(home: &Path) -> Vec<PathBuf> {
    vec![home.join("Library/Application Support/Steam")]
}

#[cfg(any(target_os = "linux", test))]
fn artifact(name: &str) -> bool {
    name.len() <= 160
        && name
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

#[cfg(any(target_os = "linux", test))]
fn json_file(path: &Path) -> io::Result<serde_json::Value> {
    use std::io::Read;
    const LIMIT: u64 = 8 * 1024 * 1024;
    if !fs::metadata(path)?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Expected a regular file",
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > LIMIT {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "File too large"));
    }
    serde_json::from_slice(&bytes).map_err(io::Error::from)
}

#[cfg(any(target_os = "linux", test))]
fn heroic_games(manifest: &Path) -> Report {
    let doc = match json_file(manifest) {
        Ok(doc) => doc,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Report::ok(),
        Err(e) => return Report::failure(format!("{}: {e}", manifest.display())),
    };
    let Some(rows) = doc.as_object() else {
        return Report::failure(format!("{}: invalid game list", manifest.display()));
    };
    let mut report = Report::ok();
    for (app, row) in rows {
        if !artifact(app)
            || row["app_name"].as_str() != Some(app.as_str())
            || row["is_dlc"] == true
            || row["is_preloaded"] == true
            || row["executable"].as_str().is_none_or(str::is_empty)
        {
            continue;
        }
        let Some(name) = row["title"]
            .as_str()
            .filter(|s| !s.trim().is_empty() && !s.chars().any(char::is_control))
        else {
            continue;
        };
        let Some(root) = row["install_path"]
            .as_str()
            .map(Path::new)
            .filter(|p| p.is_absolute() && p.parent().is_some())
        else {
            continue;
        };
        match fs::metadata(root) {
            Ok(info) if info.is_dir() => {}
            Err(e) if e.kind() != io::ErrorKind::NotFound => {
                report.complete = false;
                report.warnings.push(format!("{}: {e}", root.display()));
                continue;
            }
            _ => continue,
        }
        report.items.push(Item {
            id: format!("epic:heroic:{app}"),
            name: name.trim().into(),
            source: "epic".into(),
            target: format!("heroic://launch/legendary/{app}"),
            root: root.into(),
            icon_files: Vec::new(),
            cover: None,
            hero: None,
        });
    }
    report
}

#[cfg(target_os = "linux")]
fn heroic_dirs(home: &Path) -> [PathBuf; 2] {
    let folder = "heroic/legendaryConfig/legendary";
    [
        xdg("XDG_CONFIG_HOME", home.join(".config")).join(folder),
        home.join(".var/app/com.heroicgameslauncher.hgl/config")
            .join(folder),
    ]
}

#[cfg(target_os = "linux")]
fn epic_games(home: &Path) -> Report {
    let mut report = Report::ok();
    let mut ids = HashSet::new();
    for dir in heroic_dirs(home) {
        merge(
            &mut report,
            heroic_games(&dir.join("installed.json")),
            &mut ids,
        );
    }
    report
}

#[cfg(target_os = "macos")]
fn epic_games(home: &Path) -> Report {
    let mut report = crate::catalog::epic_installations(
        &home.join("Library/Application Support/Epic"),
        &[],
        &[],
    );
    let mut ids = report.items.iter().map(|g| g.id.clone()).collect();
    for dir in [
        "/Users/Shared/Epic Games/Launcher/Data/Manifests",
        "/Library/Application Support/Epic/EpicGamesLauncher/Data/Manifests",
    ] {
        let path = Path::new(dir);
        if path.try_exists().unwrap_or(true) {
            merge(&mut report, crate::catalog::epic_scan(path), &mut ids);
        }
    }
    report
}

pub fn source(name: &str) -> Report {
    let home = match home() {
        Ok(h) => h,
        Err(e) => return Report::failure(e),
    };
    match name {
        "steam" => steam_libraries(&steam_roots(&home)),
        "epic" => epic_games(&home),
        _ => Report::failure("Unsupported source".into()),
    }
}

#[cfg(target_os = "linux")]
pub fn artwork_id(id: &str) -> String {
    if let Some(app) = id.strip_prefix("epic:heroic:").filter(|s| artifact(s))
        && let Ok(home) = home()
    {
        for dir in heroic_dirs(&home) {
            if let Ok(doc) = json_file(&dir.join("metadata").join(format!("{app}.json")))
                && doc["app_name"].as_str() == Some(app)
                && let (Some(ns), Some(item)) = (
                    doc["metadata"]["namespace"].as_str(),
                    doc["metadata"]["id"].as_str(),
                )
                && artifact(ns)
                && item.len() == 32
                && item.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return format!("epic:{ns}:{item}:{app}");
            }
        }
    }
    id.into()
}

fn open_uri(uri: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    let mut command = {
        let mut cmd = Command::new("/usr/bin/gio");
        cmd.arg("open");
        cmd
    };
    #[cfg(target_os = "macos")]
    let mut command = Command::new("/usr/bin/open");
    let status = command.arg(uri).status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Launcher handoff failed ({status})"))
    }
}

pub fn open_platform(name: &str) -> Result<(), String> {
    open_uri(match name {
        "steam" => "steam://open/games",
        #[cfg(target_os = "linux")]
        "epic" => "heroic://ping",
        #[cfg(target_os = "macos")]
        "epic" => "com.epicgames.launcher://library",
        _ => return Err("Unsupported source".into()),
    })
}

fn dispatch(
    report: Report,
    id: &str,
    open: impl FnOnce(&str) -> Result<(), String>,
) -> Result<Item, String> {
    let game = report
        .items
        .into_iter()
        .find(|g| g.id == id)
        .ok_or("Game is not installed")?;
    open(&game.target)?;
    Ok(game)
}

pub fn launch(id: &str) -> Result<Item, String> {
    let (source_name, _) = id.split_once(':').ok_or("Invalid game ID")?;
    if !matches!(source_name, "steam" | "epic") {
        return Err("Unsupported source".into());
    }
    // A cached or WebView-supplied target cannot authorize an installation that disappeared.
    dispatch(source(source_name), id, open_uri)
}

/// Probe the game installation. A failed process inventory is unknown, including when a game previously ran.
pub fn processes_in(root: &Path) -> Option<bool> {
    let root = root.canonicalize().ok()?;
    root.parent()?;
    #[cfg(target_os = "linux")]
    {
        let processes = fs::read_dir("/proc").ok()?;
        Some(
            processes
                .flatten()
                .filter(|p| {
                    p.file_name()
                        .as_encoded_bytes()
                        .iter()
                        .all(u8::is_ascii_digit)
                })
                .any(|proc| {
                    let dir = proc.path();
                    if fs::read_link(dir.join("exe")).is_ok_and(|p| p.starts_with(&root)) {
                        return true;
                    }
                    // Wine exposes its loader as the native executable and the Windows image in comm.
                    fs::read_to_string(dir.join("comm"))
                        .is_ok_and(|s| s.trim_end().to_ascii_lowercase().ends_with(".exe"))
                        && fs::read_link(dir.join("cwd")).is_ok_and(|p| p.starts_with(&root))
                }),
        )
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        let out = Command::new("/bin/ps")
            .args(["-axww", "-o", "comm="])
            .output()
            .ok()?;
        out.status.success().then(|| {
            out.stdout.split(|b| *b == b'\n').any(|line| {
                let path = Path::new(std::ffi::OsStr::from_bytes(line.trim_ascii_start()));
                path.is_absolute()
                    && (path.starts_with(&root)
                        || path.canonicalize().is_ok_and(|p| p.starts_with(&root)))
            })
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::tempdir;

    #[test]
    fn steam_deduplicates_roots_and_loads_art() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("Steam");
        let dir = root.join("steamapps");
        fs::create_dir_all(dir.join("common/A Game")).unwrap();
        fs::write(dir.join("libraryfolders.vdf"), r#""libraryfolders" {}"#).unwrap();
        fs::write(
            dir.join("appmanifest_10.acf"),
            r#""AppState" { "appid" "10" "name" "A Game" "installdir" "A Game" "StateFlags" "4" }"#,
        )
        .unwrap();
        let cache = root.join("appcache");
        fs::create_dir_all(cache.join("librarycache/10")).unwrap();
        let data = b"\x00appinfo\0\x00common\0\x01type\0game\0\x08\x08\x08";
        let mut bytes = vec![0x28, 0x44, 0x56, 0x07, 1, 0, 0, 0];
        bytes.extend(10u32.to_le_bytes());
        bytes.extend((60 + data.len() as u32).to_le_bytes());
        bytes.extend([0; 60]);
        bytes.extend(data);
        bytes.extend([0; 4]);
        fs::write(cache.join("appinfo.vdf"), bytes).unwrap();
        fs::write(cache.join("librarycache/10/library_capsule.jpg"), "art").unwrap();
        let alias = tmp.path().join("steam-alias");
        std::os::unix::fs::symlink(&root, &alias).unwrap();
        let scan = steam_libraries(&[root, alias, tmp.path().join("missing")]);
        assert!(scan.complete, "{:?}", scan.warnings);
        assert_eq!(scan.items.len(), 1);
        assert_eq!(scan.items[0].target, "steam://run/10");
        assert!(
            scan.items[0]
                .cover
                .as_ref()
                .unwrap()
                .ends_with("library_capsule.jpg")
        );
    }

    #[test]
    fn heroic_launches_only_installed_valid_game_ids_via_registered_handler() {
        let tmp = tempdir().unwrap();
        let manifest = tmp.path().join("installed.json");
        let root = tmp.path().join("my game");
        fs::create_dir(&root).unwrap();
        let game = |app: &str| json!({"app_name":app,"title":"My Epic Game","install_path":root,"executable":"GAME.exe","launch_parameters":"--ignored"});
        let mut dlc = game("Dlc");
        dlc["is_dlc"] = true.into();
        let mut missing = game("Removed");
        missing["install_path"] = json!(tmp.path().join("missing"));
        let hostile = "Game?altExe=Other";
        let rows = json!({"Game":game("Game"),"Dlc":dlc, "Removed":missing, hostile:game(hostile), "Wrong": game("Changed")});
        fs::write(&manifest, rows.to_string()).unwrap();
        let scan = heroic_games(&manifest);
        assert_eq!(scan.items.len(), 1);
        let game = &scan.items[0];
        assert_eq!(game.name, "My Epic Game");
        assert_eq!(game.source, "epic");
        let mut sent = None;
        let id = game.id.clone();
        dispatch(scan, &id, |uri| {
            sent = Some(uri.to_owned());
            Ok(())
        })
        .unwrap();
        assert_eq!(sent.as_deref(), Some("heroic://launch/legendary/Game"));
        fs::remove_dir(root).unwrap();
        assert!(
            dispatch(heroic_games(&manifest), "epic:heroic:Game", |_| panic!(
                "stale game launched"
            ))
            .is_err()
        );
        fs::write(&manifest, "not JSON").unwrap();
        assert!(!heroic_games(&manifest).complete);
    }

    #[test]
    fn observes_only_an_executable_inside_the_game_folder() {
        let tmp = tempdir().unwrap();
        let root = tmp.path().join("Game");
        fs::create_dir(&root).unwrap();
        let bin = root.join("Test Game");
        fs::copy("/bin/sleep", &bin).unwrap();
        let mut child = std::process::Command::new(&bin).arg("6").spawn().unwrap();
        let seen = (0..20).any(|_| {
            if processes_in(&root) == Some(true) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
            false
        });
        child.kill().ok();
        child.wait().unwrap();
        assert!(seen);
        assert_eq!(processes_in(&root), Some(false));
    }
}
