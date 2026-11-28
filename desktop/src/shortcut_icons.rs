//! Match launcher-created Internet Shortcuts to installed games, without opening their targets.
use polar::catalog::{Item, shortcut_target};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::Read,
    os::windows::{ffi::OsStringExt, fs::MetadataExt},
    path::{Component, Path, PathBuf, Prefix},
};
use windows_sys::Win32::{
    Storage::FileSystem::{FILE_ATTRIBUTE_REPARSE_POINT, GetDriveTypeW},
    System::Com::CoTaskMemFree,
    UI::Shell::{
        FOLDERID_CommonPrograms, FOLDERID_Desktop, FOLDERID_Programs, FOLDERID_PublicDesktop,
        KF_FLAG_DONT_VERIFY, SHGetKnownFolderPath,
    },
};

fn local_metadata(path: &Path) -> Option<fs::Metadata> {
    let mut components = path.components();
    let Component::Prefix(prefix) = components.next()? else {
        return None;
    };
    let (Prefix::Disk(drive) | Prefix::VerbatimDisk(drive)) = prefix.kind() else {
        return None;
    };
    if components.next()? != Component::RootDir || !drive.is_ascii_alphabetic() {
        return None;
    }
    if components.any(|part| {
        let Component::Normal(name) = part else {
            return true;
        };
        let text = name.to_string_lossy();
        let stem = text
            .split('.')
            .next()
            .unwrap_or("")
            .trim_end_matches(' ')
            .to_ascii_uppercase();
        text.contains([':', '/', '\\', '\0'])
            || text.ends_with(['.', ' '])
            || matches!(
                stem.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
            )
            || stem
                .strip_prefix("COM")
                .or_else(|| stem.strip_prefix("LPT"))
                .is_some_and(|n| {
                    matches!(
                        n,
                        "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
    }) {
        return None;
    }
    let root = [u16::from(drive), 58, 92, 0];
    if !matches!(unsafe { GetDriveTypeW(root.as_ptr()) }, 2 | 3) {
        return None;
    }
    // Check from the drive root outward before traversing a junction or a cloud placeholder.
    let mut info = None;
    for part in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        let entry = fs::symlink_metadata(part).ok()?;
        if entry.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return None;
        }
        info = Some(entry);
    }
    info
}

pub(super) fn local_file(path: &Path) -> bool {
    local_metadata(path).is_some_and(|m| m.is_file())
}

fn known_folder(id: &windows_sys::core::GUID) -> Option<PathBuf> {
    let mut raw = std::ptr::null_mut();
    unsafe {
        let hr = SHGetKnownFolderPath(
            id,
            KF_FLAG_DONT_VERIFY as u32,
            std::ptr::null_mut(),
            &mut raw,
        );
        let path = if hr >= 0 && !raw.is_null() {
            let mut len = 0;
            while *raw.add(len) != 0 {
                len += 1;
            }
            Some(PathBuf::from(std::ffi::OsString::from_wide(
                std::slice::from_raw_parts(raw, len),
            )))
        } else {
            None
        };
        CoTaskMemFree(raw.cast());
        path
    }
}

fn text(bytes: &[u8]) -> Option<String> {
    if let Some(wide) = bytes.strip_prefix(b"\xff\xfe") {
        let (pairs, remainder) = wide.as_chunks::<2>();
        if !remainder.is_empty() {
            return None;
        }
        return String::from_utf16(
            &pairs
                .iter()
                .copied()
                .map(u16::from_le_bytes)
                .collect::<Vec<_>>(),
        )
        .ok();
    }
    std::str::from_utf8(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes))
        .ok()
        .map(str::to_owned)
}

fn icon_path(shortcut: &Path, value: &str) -> Option<PathBuf> {
    let raw = value
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .unwrap_or(value);
    // Launchers may use a leading environment variable for the install directory.
    let path = if let Some(expand) = raw.strip_prefix('%') {
        let (var, suffix) = expand.split_once('%')?;
        if var.is_empty() || var.contains(['=', '\0']) {
            return None;
        }
        let mut base = std::env::var_os(var)?;
        base.push(suffix);
        PathBuf::from(base)
    } else {
        PathBuf::from(raw)
    };
    if !path.extension()?.to_str().is_some_and(|ext| {
        ["ico", "exe", "dll"]
            .iter()
            .any(|e| ext.eq_ignore_ascii_case(e))
    }) {
        return None;
    }
    if matches!(
        path.file_name()?.to_str()?.to_ascii_lowercase().as_str(),
        "steam.exe"
            | "steam.ico"
            | "steam_icon.ico"
            | "epicgameslauncher.exe"
            | "epicgameslauncher.ico"
            | "shell32.dll"
            | "imageres.dll"
            | "explorer.exe"
            | "url.dll"
            | "ieframe.dll"
    ) {
        return None;
    }
    let path = if path.is_absolute() {
        path
    } else {
        if !path
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
        {
            return None;
        }
        shortcut.parent()?.join(path)
    };
    local_file(&path).then_some(path)
}

pub(super) fn shortcut_icon(path: &Path) -> Option<(String, PathBuf, i32)> {
    const MAX_BYTES: u64 = 64 * 1024;
    if !path.extension()?.eq_ignore_ascii_case("url") || !local_file(path) {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_BYTES {
        return None;
    }
    let contents = text(&bytes)?;
    let (mut in_shortcut, mut url, mut icon, mut index) = (false, None, None, None);
    for line in contents.lines().map(str::trim) {
        if line.starts_with('[') {
            in_shortcut = line.eq_ignore_ascii_case("[InternetShortcut]");
            continue;
        }
        if !in_shortcut {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let slot = match key.trim().to_ascii_lowercase().as_str() {
            "url" => &mut url,
            "iconfile" => &mut icon,
            "iconindex" => &mut index,
            _ => continue,
        };
        if slot.replace(value.trim()).is_some() {
            return None;
        }
    }
    let (id, _) = shortcut_target(url?)?;
    let index = index.unwrap_or("0").parse::<i32>().ok()?;
    if index == i32::MIN {
        return None;
    }
    let file = icon_path(path, icon?)?;
    Some((id, file, index))
}

type Icons = HashMap<String, Vec<(PathBuf, i32)>>;
fn scan_roots(items: &[Item], roots: &[(PathBuf, usize)]) -> Icons {
    let ids: HashSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
    let mut aliases = HashMap::new();
    for &id in &ids {
        if let Some(epic) = id.strip_prefix("epic:")
            && let Some((_, app)) = epic.rsplit_once(':')
        {
            aliases
                .entry(app)
                .and_modify(|old| *old = None)
                .or_insert(Some(id));
        }
    }
    let mut found = Icons::new();
    for (root, depth) in roots {
        let mut pending = VecDeque::from([(root.clone(), *depth)]);
        let mut budget = 4096;
        while let Some((folder, depth)) = pending.pop_front() {
            if budget == 0 {
                break;
            }
            if !local_metadata(&folder).is_some_and(|m| m.is_dir()) {
                continue;
            }
            let Ok(directory) = fs::read_dir(&folder) else {
                continue;
            };
            let mut entries: Vec<_> = directory.take(budget).collect();
            budget -= entries.len();
            entries.sort_by_cached_key(|e| e.as_ref().ok().map(|e| e.file_name()));
            for entry in entries.into_iter().flatten() {
                let path = entry.path();
                if depth > 0 && entry.file_type().is_ok_and(|t| t.is_dir()) {
                    pending.push_back((path, depth - 1));
                    continue;
                }
                let Some((id, icon, index)) = shortcut_icon(&path) else {
                    continue;
                };
                let resolved = if let Some(short) = id.strip_prefix("epic-short:") {
                    aliases.get(short).copied().flatten()
                } else {
                    ids.get(id.as_str()).copied()
                };
                if let Some(id) = resolved {
                    let candidates = found.entry(id.to_owned()).or_default();
                    let candidate = (icon, index);
                    if candidates.len() < 8 && !candidates.contains(&candidate) {
                        candidates.push(candidate);
                    }
                }
            }
        }
    }
    found
}

pub(super) fn discover(items: &[Item]) -> Icons {
    if items.is_empty() {
        return Icons::new();
    }
    let roots = [
        (&FOLDERID_Programs, 6),
        (&FOLDERID_Desktop, 0),
        (&FOLDERID_CommonPrograms, 6),
        (&FOLDERID_PublicDesktop, 0),
    ]
    .into_iter()
    .filter_map(|(id, depth)| Some((known_folder(id)?, depth)))
    .collect::<Vec<_>>();
    scan_roots(items, &roots)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(id: &str) -> Item {
        Item {
            id: id.into(),
            source: id.split(':').next().unwrap().into(),
            name: "Same title".into(),
            root: PathBuf::new(),
            target: String::new(),
            icon_files: vec![],
            cover: None,
            hero: None,
        }
    }

    #[test]
    fn discovers_standard_game_shortcuts_by_identity_with_user_precedence() {
        let temp = tempfile::tempdir().unwrap();
        let user = temp.path().join("User");
        let common = temp.path().join("Common");
        fs::create_dir_all(user.join("Steam")).unwrap();
        fs::create_dir(&common).unwrap();
        let a = temp.path().join("First icon.ico");
        let b = temp.path().join("game.exe");
        fs::write(&a, b"icon").unwrap();
        fs::write(&b, b"exe").unwrap();
        let shortcut = |url, path: &Path, index| {
            format!(
                "[InternetShortcut]\r\nURL={url}\r\nIconFile=\"{}\"\r\nIconIndex={index}\r\n",
                path.display()
            )
        };
        let steam = shortcut("steam://rungameid/2215430", &a, 0);
        let utf16: Vec<u8> = (std::iter::once(0xfeff).chain(steam.encode_utf16()))
            .flat_map(u16::to_le_bytes)
            .collect();
        fs::write(user.join("Steam/Unrelated display name.URL"), utf16).unwrap();
        fs::write(
            common.join("ghost.url"),
            shortcut("steam://run/2215430", &b, -201),
        )
        .unwrap();
        fs::write(common.join("ghost again.url"), steam).unwrap();
        fs::write(
            user.join("death.url"),
            shortcut("com.epicgames.launcher://apps/Boga?action=launch", &b, -7),
        )
        .unwrap();
        fs::write(user.join("Ghost.url"), shortcut("steam://run/999", &a, 0)).unwrap();
        let mut items = vec![
            game("epic:ns:item:Boga"),
            game("steam:2215430"),
            game("steam:10"),
        ];
        let roots = [(user, 6), (common, 6)];
        let found = scan_roots(&items, &roots);
        assert_eq!(
            found["steam:2215430"],
            vec![(a.clone(), 0), (b.clone(), -201)]
        );
        assert_eq!(found["epic:ns:item:Boga"], vec![(b.clone(), -7)]);
        assert_eq!(found.len(), 2);
        items.push(game("epic:other:other:Boga"));
        fs::write(
            roots[0].0.join("exact.url"),
            shortcut(
                "com.epicgames.launcher://apps/ns%3Aitem%3ABoga?action=launch",
                &a,
                0,
            ),
        )
        .unwrap();
        let found = scan_roots(&items, &roots);
        assert_eq!(found["epic:ns:item:Boga"], vec![(a, 0)]);
        assert!(!found.contains_key("epic:other:other:Boga"));
    }

    #[test]
    fn rejects_reparse_ancestors_unsafe_icon_locations_and_malformed_shortcuts() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        let icon = dir.join("ok.ico");
        fs::write(&icon, b"ok").unwrap();
        assert!(local_file(&icon));
        for path in [
            r"\\server\share\i.ico",
            r"\\?\UNC\server\share\i.ico",
            r"\\.\pipe\x.ico",
            r"C:relative.ico",
            r"C:\x.ico:stream",
        ] {
            assert!(!local_file(Path::new(path)));
        }
        let shortcuts = dir.join("shortcuts");
        fs::create_dir(&shortcuts).unwrap();
        let link = shortcuts.join("foo.url");
        fs::write(shortcuts.join("ok.ico"), b"icon").unwrap();
        fs::write(shortcuts.join("Steam.EXE"), b"launcher").unwrap();
        let text = |parts: &str| format!("[InternetShortcut]\nURL=steam://rungameid/1\n{parts}");
        for invalid in [
            "IconFile=https://example.org/art.ico",
            r"IconFile=\\server\share\x.ico",
            "[Other]\nIconFile=ok.ico",
            "IconFile=Steam.EXE",
            "IconFile=ok.ico\nIconIndex=oops",
        ] {
            fs::write(&link, text(invalid)).unwrap();
            assert!(shortcut_icon(&link).is_none());
        }
        fs::write(
            &link,
            format!(
                "{}{}",
                text(&format!("IconFile={}\n", icon.display())),
                " ".repeat(65_536)
            ),
        )
        .unwrap();
        assert!(shortcut_icon(&link).is_none());
        // Directory junctions require no symlink privilege on Windows.
        let outside = dir.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("copy.ico"), b"file").unwrap();
        let junction = shortcuts.join("junction");
        let result = std::process::Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(result.status.success());
        assert!(!local_file(&junction.join("copy.ico")));
        fs::remove_dir(junction).unwrap();
    }
}
