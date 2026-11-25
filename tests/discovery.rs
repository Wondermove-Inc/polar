mod common;
use common::*;
use polar::{launch_uri, scan};
use std::{fs, path::Path};
use tempfile::tempdir;

#[test]
fn merges_legacy_and_current_libraries_and_deduplicates_by_id() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("Steam");
    let old = tmp.path().join("게임 디스크");
    let new = tmp.path().join("New Library");
    let config = format!(
        r#""LibraryFolders" {{ "1" "{}" "2" {{ "path" "{}" "apps" {{ "5" "1" }} }} }}"#,
        vdf_path(&old),
        vdf_path(&new)
    );
    library(&root, &config);
    library(&old, r#"libraryfolders {}"#);
    library(&new, r#"libraryfolders {}"#);
    install(&root, 10, "Zed");
    install(&old, 4, "Alpha");
    install(&new, 5, "Alpha");
    install(&new, 10, "Duplicate");
    let report = scan(&root);
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    assert_eq!(
        report
            .games
            .iter()
            .map(|g| (g.id, g.name.as_str()))
            .collect::<Vec<_>>(),
        [(4, "Alpha"), (5, "Alpha"), (10, "Zed")]
    );
    assert_eq!(launch_uri(&report, 5).as_deref(), Some("steam://run/5"));
    assert_eq!(launch_uri(&report, 9), None);
}

#[test]
fn only_eligible_verified_manifests_can_supply_launch_ids() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();
    library(root, "libraryfolders {}");
    install(root, 1, "Valid");
    manifest(root, 1, "1", "Valid", "Valid", "6");
    manifest(root, 2, "3", "Spoof", "Valid", "4");
    manifest(root, 3, "3", "Partial", "Valid", "2");
    manifest(root, 4, "4", "Not on disk", "Missing", "4");
    manifest(root, 5, "5", "Traversal", "..", "4");
    manifest(root, 6, "6", " ", "Valid", "4");
    manifest(root, 7, "7", "Absolute", "C:/Games", "4");
    manifest(root, 8, "8", "Nested", "common\\\\Valid", "4");
    manifest(root, 9, "9", "Invalid number", "Valid", "NaN");
    manifest(root, 0, "0", "Zero", "Valid", "4");
    fs::write(root.join("steamapps/appmanifest_11.acf"), "AppState {").unwrap();
    let report = scan(root);
    assert_eq!(report.games.iter().map(|g| g.id).collect::<Vec<_>>(), [1]);
    assert!(!report.warnings.is_empty());
    for id in [0, 2, 3, 4, 5, 6, 7, 8, 9, 11] {
        assert_eq!(launch_uri(&report, id), None)
    }
}

#[test]
fn failed_library_or_broken_configuration_keeps_verified_games() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();
    for config in [
        format!(
            "libraryfolders {{ 1 {{ path \"{}\" }} }}",
            vdf_path(&root.join("disconnected"))
        ),
        "broken {".into(),
    ] {
        library(root, &config);
        install(root, 7, "Local");
        let report = scan(root);
        assert_eq!(report.games[0].id, 7);
        assert_eq!(launch_uri(&report, 7).as_deref(), Some("steam://run/7"));
        assert!(!report.warnings.is_empty());
    }
}

fn vdf_path(path: &Path) -> String {
    path.to_str().unwrap().replace('\\', "\\\\")
}

// A literal backslash is a valid Unix filename character. It lets host tests
// exercise the double-backslash VDF encoding used by Windows Steam libraries.
#[cfg(unix)]
#[test]
fn resolves_escaped_backslashes_in_a_library_path() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("Steam");
    let extra = tmp.path().join(r"steam\games");
    library(
        &root,
        &format!(
            r#"libraryfolders {{ 1 {{ path "{}" }} }}"#,
            vdf_path(&extra)
        ),
    );
    library(&extra, "libraryfolders {}");
    install(&extra, 8, "Fixture Game");
    let report = scan(&root);
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    assert_eq!(report.games[0].id, 8);
}
