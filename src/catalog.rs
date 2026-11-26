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
    #[serde(flatten)]
    identity: EpicIdentity,
    #[serde(default)]
    main_game_app_name: String,
    #[serde(default)]
    launch_executable: String,
    #[serde(default, rename = "bIsIncompleteInstall")]
    incomplete: bool,
    #[serde(default)]
    app_categories: Vec<String>,
}
fn epic_uri(parts: [&str; 3]) -> Option<(String, String)> {
    if parts[0].eq_ignore_ascii_case("ue") || parts[2].starts_with("UE_") {
        return None;
    }
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

fn epic_json(path: &Path) -> Result<serde_json::Value, String> {
    use std::io::Read;
    let mut data = Vec::new();
    fs::File::open(path)
        .and_then(|f| f.take(8 * 1024 * 1024 + 1).read_to_end(&mut data))
        .map_err(|e| format!("{}: {e}", path.display()))?;
    if data.len() > 8 * 1024 * 1024 {
        return Err(format!("{}: file too large", path.display()));
    }
    serde_json::from_slice(data.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&data))
        .map_err(|e| format!("{}: {e}", path.display()))
}

fn extension(path: &Path, ext: &str) -> bool {
    path.extension()
        .is_some_and(|s| s.eq_ignore_ascii_case(ext))
}

fn paths(folder: &Path, optional: bool, report: &mut Report) -> Vec<PathBuf> {
    match fs::read_dir(folder) {
        Ok(entries) => entries
            .filter_map(|entry| match entry {
                Ok(entry) => Some(entry.path()),
                Err(e) => {
                    report.warn(format!("{}: {e}", folder.display()));
                    None
                }
            })
            .collect(),
        Err(e) => {
            if !optional || e.kind() != std::io::ErrorKind::NotFound {
                report.warn(format!("{}: {e}", folder.display()));
            }
            vec![]
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct EpicIdentity {
    catalog_namespace: String,
    catalog_item_id: String,
    app_name: String,
}
impl EpicIdentity {
    fn target(&self) -> Option<(String, String)> {
        epic_uri([
            &self.catalog_namespace,
            &self.catalog_item_id,
            &self.app_name,
        ])
    }
}

#[derive(Default)]
struct EpicLibrary {
    seen: HashSet<String>,
    installed: HashSet<PathBuf>,
    rejected: std::collections::HashMap<PathBuf, HashSet<String>>,
    checked: HashSet<PathBuf>,
}
impl EpicLibrary {
    fn excluded(&self, root: &Path, id: &str) -> bool {
        self.rejected.get(root).is_some_and(|set| set.contains(id))
    }
    fn add(
        &mut self,
        report: &mut Report,
        target: (String, String),
        root: PathBuf,
        name: Option<String>,
    ) {
        let (id, target) = target;
        if self.seen.contains(&id) {
            return;
        }
        if !root.is_absolute() || !root.is_dir() {
            report.warn(format!("{}: {}", id, root.display()));
            return;
        }
        let Some(name) = name
            .filter(|s| !s.trim().is_empty())
            .or_else(|| root.file_name()?.to_str().map(str::to_owned))
        else {
            return;
        };
        self.seen.insert(id.clone());
        self.installed.insert(root.clone());
        report.items.push(Item {
            id,
            name,
            source: "epic".into(),
            target,
            root,
            cover: None,
            hero: None,
        });
    }

    fn manifests(&mut self, folder: &Path, optional: bool, report: &mut Report) {
        for file in paths(folder, optional, report)
            .into_iter()
            .filter(|p| extension(p, "item"))
        {
            let parsed = epic_json(&file).and_then(|doc| {
                serde_json::from_value::<Epic>(doc).map_err(|e| format!("{}: {e}", file.display()))
            });
            let rec = match parsed {
                Ok(rec) => rec,
                Err(e) => {
                    report.warn(e);
                    continue;
                }
            };
            let Some(target) = rec.identity.target() else {
                continue;
            };
            if rec.incomplete
                || rec.launch_executable.trim().is_empty()
                || rec.app_categories.iter().any(|s| {
                    ["engines", "dlc", "plugins"]
                        .iter()
                        .any(|t| s.eq_ignore_ascii_case(t))
                })
                || (!rec.main_game_app_name.is_empty()
                    && rec.main_game_app_name != rec.identity.app_name)
            {
                self.rejected
                    .entry(rec.install_location)
                    .or_default()
                    .insert(target.0);
                continue;
            }
            self.add(report, target, rec.install_location, Some(rec.display_name));
        }
    }

    fn index(&mut self, db: &Path, report: &mut Report) -> Result<(), String> {
        if !db
            .try_exists()
            .map_err(|e| format!("{}: {e}", db.display()))?
        {
            return Ok(());
        }
        let doc = epic_json(db)?;
        let entries = doc["InstallationList"]
            .as_array()
            .ok_or_else(|| format!("{}: invalid InstallationList", db.display()))?;
        let mut grouped = std::collections::BTreeMap::<PathBuf, Vec<&serde_json::Value>>::new();
        for entry in entries {
            if let Some(root) = entry["InstallLocation"]
                .as_str()
                .map(PathBuf::from)
                .filter(|p| p.is_absolute())
            {
                grouped.entry(root).or_default().push(entry);
            }
        }
        for (root, rows) in grouped {
            if self.game_folder(&root, report) {
                continue;
            }
            let mut candidates = std::collections::BTreeMap::new();
            for row in rows {
                let parts = [
                    row["NamespaceId"].as_str(),
                    row["ItemId"].as_str(),
                    row["ArtifactId"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .or(row["AppName"].as_str()),
                ];
                if let [Some(ns), Some(item), Some(app)] = parts
                    && let Some((id, target)) = epic_uri([ns, item, app])
                    && !self.excluded(&root, &id)
                {
                    candidates.insert(id, (target, row["DisplayName"].as_str().map(str::to_owned)));
                }
            }
            if candidates.len() == 1
                && let Some((id, (target, name))) = candidates.pop_first()
            {
                self.add(report, (id, target), root, name);
            } else if candidates.len() > 1 {
                report.warn(format!(
                    "{}: ambiguous Epic install records",
                    root.display()
                ));
            }
        }
        Ok(())
    }

    // Return true when local metadata settles this folder, including pending or ambiguous installs.
    fn game_folder(&mut self, root: &Path, report: &mut Report) -> bool {
        if self.installed.contains(root) || !self.checked.insert(root.into()) {
            return true;
        }
        let store = root.join(".egstore");
        let mut candidates = Vec::new();
        let mut has_record = false;
        for file in paths(&store, true, report) {
            let name = file.file_name().unwrap_or_default();
            if (name.eq_ignore_ascii_case("bps") || name.eq_ignore_ascii_case("Pending"))
                && !paths(&file, false, report).is_empty()
            {
                return true;
            }
            if !extension(&file, "mancpn") {
                continue;
            }
            if !file
                .with_extension("manifest")
                .metadata()
                .is_ok_and(|m| m.is_file() && m.len() > 0)
            {
                continue;
            }
            match epic_json(&file).and_then(|doc| {
                serde_json::from_value::<EpicIdentity>(doc)
                    .map_err(|e| format!("{}: {e}", file.display()))
            }) {
                Ok(identity) => {
                    has_record = true;
                    if let Some(target) = identity.target()
                        && !self.excluded(root, &target.0)
                        && !candidates.contains(&target)
                    {
                        candidates.push(target)
                    }
                }
                Err(e) => report.warn(e),
            }
        }
        if candidates.len() == 1 {
            self.add(report, candidates.pop().unwrap(), root.into(), None);
        } else if candidates.len() > 1 {
            report.warn(format!(
                "{}: ambiguous Epic install records",
                root.display()
            ));
        }
        has_record
    }
}
pub fn epic_scan(folder: &Path) -> Report {
    let mut report = Report::ok();
    EpicLibrary::default().manifests(folder, false, &mut report);
    report
}
pub fn epic_installations(data: &Path, drives: &[PathBuf], custom: &[PathBuf]) -> Report {
    let mut report = Report::ok();
    let mut library = EpicLibrary::default();
    let manifests = data.join("EpicGamesLauncher/Data/Manifests");
    library.manifests(&manifests, true, &mut report);
    let db = data.join("UnrealEngineLauncher/LauncherInstalled.dat");
    if let Err(e) = library.index(&db, &mut report) {
        report.warn(e);
    }
    let mut scanned = HashSet::new();
    for (root, optional) in custom
        .iter()
        .cloned()
        .map(|p| (p, false))
        .chain(drives.iter().map(|d| (d.join("Epic Games"), true)))
    {
        if !scanned.insert(root.clone()) {
            continue;
        }
        if !optional && root.join(".egstore").is_dir() {
            library.game_folder(&root, &mut report);
            continue;
        }
        for child in paths(&root, optional, &mut report) {
            if child.is_dir() {
                library.game_folder(&child, &mut report);
            }
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
        let visuals = game.children().find(|n| n.has_tag_name("ShellVisuals"));
        let asset = |key: &str| {
            let p = root.join(visuals?.attribute(key)?).canonicalize().ok()?;
            (p.is_file() && p.starts_with(root.canonicalize().ok()?)).then_some(p)
        };
        let cover = asset("Square480x480Logo").or_else(|| asset("Square150x150Logo"));
        let hero = asset("SplashScreenImage");
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
                hero: hero.clone(),
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
