//! Per-source discovery. Only display fields cross the WebView boundary.
use percent_encoding::{NON_ALPHANUMERIC, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub source: String,
    #[serde(skip)]
    pub target: String,
    #[serde(skip)]
    pub root: PathBuf,
    #[serde(skip)]
    pub cover: Option<PathBuf>,
    #[serde(skip)]
    pub hero: Option<PathBuf>,
}
#[derive(Default, Debug, Serialize)]
pub struct Report {
    pub items: Vec<Item>,
    pub warnings: Vec<String>,
    pub complete: bool,
}
impl Report {
    pub fn ok() -> Self {
        Self {
            complete: true,
            ..Self::default()
        }
    }
    pub fn failure(error: String) -> Self {
        Self {
            warnings: vec![error],
            ..Self::default()
        }
    }
    fn warn(&mut self, s: String) {
        self.complete = false;
        self.warnings.push(s);
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Registration {
    pub id: String,
    pub name: String,
    pub root: PathBuf,
}

pub fn steam_scan() -> Report {
    let root = match crate::registered_root() {
        Ok(r) => r,
        Err(e) => return Report::failure(e),
    };
    let scan = crate::scan(&root);
    let cache = root.join("appcache/librarycache");
    let mut result = Report {
        complete: scan.warnings.is_empty(),
        warnings: scan.warnings,
        items: vec![],
    };
    let ids = scan.games.iter().map(|g| g.id).collect();
    let kinds = crate::appinfo::installed(&root.join("appcache"), &ids);
    let mut unknown = 0;
    for g in scan.games {
        if !kinds.contains_key(&g.id) {
            unknown += 1;
            continue;
        }
        if kinds.get(&g.id) != Some(&true) || g.id == 228980 {
            continue;
        }
        let id = g.id.to_string();
        let cover = steam_image(&cache, &id, "library_600x900");
        let hero = steam_image(&cache, &id, "library_hero");
        result.items.push(Item {
            id: format!("steam:{id}"),
            name: g.name,
            source: "steam".into(),
            target: format!("steam://run/{id}"),
            root: g.installation,
            cover,
            hero,
        });
    }
    if unknown > 0 {
        result.warn(format!(
            "appcache/appinfo: {unknown} unclassified Steam apps"
        ))
    }
    result
}
fn steam_image(cache: &Path, id: &str, kind: &str) -> Option<PathBuf> {
    let folder = cache.join(id);
    for p in [
        cache.join(format!("{id}_{kind}.jpg")),
        folder.join(format!("{kind}.jpg")),
    ] {
        if p.is_file() {
            return Some(p);
        }
    }
    // Current clients can put each asset in a hash-named subdirectory.
    for e in fs::read_dir(folder).ok()?.flatten() {
        let p = e.path().join(format!("{kind}.jpg"));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Epic {
    display_name: String,
    install_location: PathBuf,
    app_name: String,
    catalog_item_id: String,
    catalog_namespace: String,
    #[serde(default)]
    launch_executable: String,
    #[serde(default, rename = "bIsIncompleteInstall")]
    incomplete: bool,
    #[serde(default)]
    app_categories: Vec<String>,
}
fn epic_uri(parts: [&str; 3]) -> Option<(String, String)> {
    if parts
        .iter()
        .any(|s| s.trim().is_empty() || s.contains(':') || s.chars().any(char::is_control))
    {
        return None;
    }
    let encoded = parts
        .map(|s| utf8_percent_encode(s, NON_ALPHANUMERIC).to_string())
        .join("%3A");
    Some((
        format!("epic:{}", parts.join(":")),
        format!("com.epicgames.launcher://apps/{encoded}?action=launch&silent=true"),
    ))
}

pub fn epic_scan(folder: &Path) -> Report {
    let mut report = Report::ok();
    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(e) => return Report::failure(format!("{}: {e}", folder.display())),
    };
    let mut seen = HashSet::new();
    for file in entries {
        let file = match file {
            Ok(e) => e.path(),
            Err(e) => {
                report.warn(e.to_string());
                continue;
            }
        };
        if file.extension().and_then(|e| e.to_str()) != Some("item") {
            continue;
        }
        let parsed = fs::read(&file)
            .map_err(|e| e.to_string())
            .and_then(|data| serde_json::from_slice::<Epic>(&data).map_err(|e| e.to_string()));
        let rec = match parsed {
            Ok(rec) => rec,
            Err(e) => {
                report.warn(format!("{}: {e}", file.display()));
                continue;
            }
        };
        if rec.incomplete
            || rec.launch_executable.is_empty()
            || rec
                .app_categories
                .iter()
                .any(|s| s.eq_ignore_ascii_case("engines"))
        {
            continue;
        }
        if !rec.install_location.is_absolute() || !rec.install_location.is_dir() {
            report.warn(format!(
                "{}: {}",
                rec.display_name,
                rec.install_location.display()
            ));
            continue;
        }
        if let Some((id, target)) =
            epic_uri([&rec.catalog_namespace, &rec.catalog_item_id, &rec.app_name])
            && seen.insert(id.clone())
            && !rec.display_name.trim().is_empty()
        {
            report.items.push(Item {
                id,
                name: rec.display_name,
                source: "epic".into(),
                target,
                root: rec.install_location,
                cover: None,
                hero: None,
            });
        }
    }
    report
}

pub fn xbox_games(rows: &[Registration]) -> Report {
    xbox_drives(rows, &[])
}

fn xbox_library(drive: &Path) -> Result<PathBuf, String> {
    let marker = drive.join(".GamingRoot");
    let bytes = match fs::read(&marker) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(drive.join("XboxGames")),
        Err(e) => return Err(format!("{}: {e}", marker.display())),
    };
    let data = bytes
        .strip_prefix(b"RGBX\x01\0\0\0")
        .ok_or("Invalid .GamingRoot header")?;
    let (units, odd) = data.as_chunks::<2>();
    if !odd.is_empty() {
        return Err("Invalid .GamingRoot path".into());
    }
    let name = String::from_utf16(
        &units
            .iter()
            .copied()
            .map(u16::from_le_bytes)
            .collect::<Vec<_>>(),
    )
    .map_err(|e| e.to_string())?;
    let mut folder = drive.to_owned();
    for segment in name.trim_end_matches('\0').split(['/', '\\']) {
        if segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.contains(':')
            || segment.chars().any(char::is_control)
        {
            return Err("Invalid .GamingRoot folder".into());
        }
        folder.push(segment);
    }
    Ok(folder)
}

pub fn xbox_drives(rows: &[Registration], drives: &[PathBuf]) -> Report {
    let mut report = Report::ok();
    let mut roots = Vec::new();
    for drive in drives {
        let library = match xbox_library(drive) {
            Ok(p) => p,
            Err(e) => {
                report.warn(e);
                continue;
            }
        };
        match fs::read_dir(&library) {
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(entry) => roots.push(entry.path().join("Content")),
                        Err(e) => report.warn(e.to_string()),
                    }
                }
            }
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                report.warn(format!("{}: {e}", library.display()))
            }
            _ => {}
        }
    }
    let mut direct = std::collections::HashMap::<PathBuf, Vec<&Registration>>::new();
    for row in rows.iter().filter(|r| r.root.is_absolute()) {
        for root in [row.root.clone(), row.root.join("Content")] {
            direct.entry(root).or_default().push(row);
        }
    }
    let mut seen = HashSet::new();
    // Writable XboxGames content directories give the game process's actual installation root.
    roots.extend(direct.keys().cloned());
    for root in roots {
        if !seen.insert(root.clone()) {
            continue;
        }
        let cfg = root.join("MicrosoftGame.config");
        let xml = match fs::read_to_string(&cfg) {
            Ok(x) => x,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => {
                report.warn(format!("{}: {e}", cfg.display()));
                continue;
            }
        };
        let doc = match roxmltree::Document::parse(xml.trim_start_matches('\u{feff}')) {
            Ok(x) => x,
            Err(e) => {
                report.warn(format!("{}: {e}", cfg.display()));
                continue;
            }
        };
        let game = doc.root_element();
        let Some(identity) = game
            .children()
            .find(|n| n.has_tag_name("Identity"))
            .and_then(|n| n.attribute("Name"))
        else {
            continue;
        };
        if !game.has_tag_name("Game") {
            continue;
        }
        let matching = |row: &Registration| {
            row.id.split_once('!').is_some_and(|(family, app)| {
                family
                    .rsplit_once('_')
                    .is_some_and(|(name, _)| name == identity)
                    && game.descendants().any(|n| {
                        n.has_tag_name("Executable") && n.attribute("Id").unwrap_or("Game") == app
                    })
            })
        };
        let candidates: Vec<_> = if let Some(registered) = direct.get(&root) {
            registered.iter().copied().filter(|r| matching(r)).collect()
        } else {
            let matching: Vec<_> = rows.iter().filter(|r| matching(r)).collect();
            let families: HashSet<_> = matching
                .iter()
                .filter_map(|r| r.id.split_once('!').map(|p| p.0))
                .collect();
            if families.len() > 1 {
                continue;
            }
            matching
        };
        let cover = game
            .children()
            .find(|n| n.has_tag_name("ShellVisuals"))
            .and_then(|n| n.attribute("Square150x150Logo"))
            .map(|s| root.join(s))
            .and_then(|p| p.canonicalize().ok())
            .filter(|p| root.canonicalize().is_ok_and(|r| p.starts_with(r)));
        for row in candidates {
            let id = format!("xbox:{}", row.id);
            if report.items.iter().any(|g| g.id == id) {
                continue;
            }
            report.items.push(Item {
                id,
                name: row.name.clone(),
                source: "xbox".into(),
                target: format!("shell:AppsFolder\\{}", row.id),
                root: root.clone(),
                cover: cover.clone(),
                hero: None,
            });
        }
    }
    report
}

/// Normalize Internet Shortcuts to launch schemes built from verified fields.
pub fn shortcut_target(url: &str) -> Option<(String, String)> {
    for prefix in ["steam://rungameid/", "steam://run/"] {
        if let Some(raw) = url.strip_prefix(prefix) {
            let id = crate::parse_id(raw)?;
            return Some((format!("steam:{id}"), format!("steam://run/{id}")));
        }
    }
    let (encoded, query) = url
        .strip_prefix("com.epicgames.launcher://apps/")?
        .split_once('?')?;
    if !query.split('&').any(|p| p == "action=launch") {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .ok()?;
    let parts: Vec<_> = decoded.split(':').collect();
    if parts.len() == 1
        && !parts[0].is_empty()
        && parts[0]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        let key = parts[0];
        return Some((
            format!("epic-short:{key}"),
            format!("com.epicgames.launcher://apps/{key}?action=launch&silent=true"),
        ));
    }
    epic_uri(parts.try_into().ok()?)
}
