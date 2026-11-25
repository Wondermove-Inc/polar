//! Read-only discovery of local Steam applications.

use keyvalues_parser::{Obj, Value};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, PartialEq, Eq)]
pub struct Game {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Default)]
pub struct Scan {
    pub games: Vec<Game>,
    pub warnings: Vec<String>,
    pub libraries_read: usize,
}

pub fn parse_id(raw: &str) -> Option<u32> {
    if !raw.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    raw.parse().ok().filter(|&id| id != 0)
}

pub fn launch_uri(scan: &Scan, id: u32) -> Option<String> {
    scan.games
        .iter()
        .any(|game| game.id == id)
        .then(|| format!("steam://run/{id}"))
}

fn text<'a>(obj: &'a Obj<'_>, key: &str) -> Result<&'a str, String> {
    obj.get(key)
        .and_then(|values| match values.as_slice() {
            [value] => value.get_str(),
            _ => None,
        })
        .ok_or_else(|| format!("missing or ambiguous {key}"))
}

fn document(path: &Path, root: &str) -> Result<Obj<'static>, String> {
    let contents = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed = keyvalues_parser::parse(contents.trim_start_matches('\u{feff}'))
        .map_err(|_| "invalid VDF syntax".to_string())?;
    if !parsed.key.eq_ignore_ascii_case(root) || !parsed.bases.is_empty() {
        return Err(format!("expected a standalone {root} object"));
    }
    match parsed.value.into_owned() {
        Value::Obj(obj) => Ok(obj),
        _ => Err(format!("expected {root} object")),
    }
}

fn library_roots(root: &Path, warnings: &mut Vec<String>) -> Vec<PathBuf> {
    let mut roots = vec![root.to_owned()];
    let config = root.join("steamapps/libraryfolders.vdf");
    match document(&config, "libraryfolders") {
        Ok(folders) => {
            for (key, entries) in folders.iter() {
                if key.is_empty() || !key.bytes().all(|b| b.is_ascii_digit()) {
                    continue;
                }
                for entry in entries {
                    let path = match entry {
                        Value::Str(s) => Some(s.as_ref()),
                        Value::Obj(obj) => text(obj, "path").ok(),
                    };
                    match path.map(Path::new).filter(|p| p.is_absolute()) {
                        Some(path) => roots.push(path.to_owned()),
                        None => warnings.push(format!(
                            "{}: invalid library path at {key}",
                            config.display()
                        )),
                    }
                }
            }
        }
        Err(error) => warnings.push(format!("{}: {error}", config.display())),
    }
    roots
}

fn read_game(apps: &Path, file: &Path, expected_id: u32) -> Result<Option<Game>, String> {
    let state = document(file, "AppState")?;
    let id = parse_id(text(&state, "appid")?).ok_or("invalid appid")?;
    if id != expected_id {
        return Err("appid differs from manifest filename".into());
    }
    let flags = text(&state, "StateFlags")?
        .parse::<u32>()
        .map_err(|_| "invalid StateFlags")?;
    if flags & 4 == 0 {
        return Ok(None);
    }
    let name = text(&state, "name")?.trim();
    if name.is_empty() || name.chars().any(char::is_control) {
        return Err("invalid name".into());
    }
    let dir = text(&state, "installdir")?;
    if dir.is_empty()
        || dir.ends_with(['.', ' '])
        || dir.contains(['/', '\\', ':'])
        || dir.chars().any(char::is_control)
    {
        return Err("invalid installdir".into());
    }
    let installation = apps.join("common").join(dir);
    match fs::metadata(&installation) {
        Ok(metadata) if metadata.is_dir() => Ok(Some(Game {
            id,
            name: name.to_owned(),
        })),
        Ok(_) => Err(format!(
            "not an installation directory: {}",
            installation.display()
        )),
        Err(e) => Err(format!("{}: {e}", installation.display())),
    }
}

/// Scan the primary library first so its manifest wins when an ID is duplicated.
pub fn scan(root: &Path) -> Scan {
    let mut result = Scan::default();
    let mut seen = HashSet::new();
    let mut games = BTreeMap::new();
    for path in library_roots(root, &mut result.warnings) {
        let apps = path.join("steamapps");
        if !seen.insert(fs::canonicalize(&apps).unwrap_or_else(|_| apps.clone())) {
            continue;
        }
        let contents = match fs::read_dir(&apps) {
            Ok(entries) => entries,
            Err(e) => {
                result.warnings.push(format!("{}: {e}", apps.display()));
                continue;
            }
        };
        result.libraries_read += 1;
        for entry in contents {
            let file = match entry {
                Ok(entry) => entry.path(),
                Err(e) => {
                    result.warnings.push(format!("{}: {e}", apps.display()));
                    continue;
                }
            };
            let Some(raw) = file
                .file_name()
                .and_then(|s| s.to_str())
                .and_then(|s| s.strip_prefix("appmanifest_"))
                .and_then(|s| s.strip_suffix(".acf"))
            else {
                continue;
            };
            let Some(id) = parse_id(raw) else {
                result
                    .warnings
                    .push(format!("{}: invalid manifest id", file.display()));
                continue;
            };
            match read_game(&apps, &file, id) {
                Ok(Some(game)) => {
                    games.entry(id).or_insert(game);
                }
                Ok(None) => {}
                Err(error) => result.warnings.push(format!("{}: {error}", file.display())),
            }
        }
    }
    result.games = games.into_values().collect();
    result
        .games
        .sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
    result
}

mod platform;
pub use platform::registered_root;

/// Request a launch from the registered client. A caller-supplied fixture root
/// can never authorize an OS launch.
pub fn request_launch(id: u32) -> Result<(), String> {
    let report = scan(&registered_root()?);
    let Some(uri) = launch_uri(&report, id) else {
        let mut message = format!("App {id} was not found in the readable Steam libraries.");
        for warning in report.warnings {
            message.push('\n');
            message.push_str(&warning);
        }
        return Err(message);
    };
    platform::open_uri(&uri)
}
