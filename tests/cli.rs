mod common;
use common::*;
use std::{
    ffi::OsStr,
    fs,
    path::Path,
    process::{Command, Output},
};
use tempfile::tempdir;

fn list(root: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_polar"))
        .arg("--steam-root")
        .arg(root)
        .arg("list")
        .output()
        .unwrap()
}

#[test]
fn list_distinguishes_empty_partial_and_unreadable_libraries() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();
    assert_eq!(list(root).status.code(), Some(1));
    library(root, r#"libraryfolders {}"#);
    let empty = list(root);
    assert!(empty.status.success());
    assert!(empty.stdout.is_empty());
    install(root, 37, "Space Game");
    let full = list(root);
    assert!(full.status.success());
    assert_eq!(
        String::from_utf8(full.stdout).unwrap().trim_end(),
        "37\tSpace Game"
    );
    fs::remove_file(root.join("steamapps/libraryfolders.vdf")).unwrap();
    let partial = list(root);
    assert_eq!(partial.status.code(), Some(2));
    assert_eq!(
        String::from_utf8(partial.stdout).unwrap().trim_end(),
        "37\tSpace Game"
    );
    assert!(String::from_utf8_lossy(&partial.stderr).contains("libraryfolders.vdf"));
}

#[test]
fn refuses_fixture_launch_and_non_decimal_ids_before_windows_access() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();
    library(root, "libraryfolders {}");
    install(root, 37, "Space Game");
    let fake = Command::new(env!("CARGO_BIN_EXE_polar"))
        .args([
            OsStr::new("--steam-root"),
            root.as_os_str(),
            OsStr::new("launch"),
            OsStr::new("37"),
        ])
        .output()
        .unwrap();
    assert_eq!(fake.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&fake.stderr).contains("Usage:"));
    for args in [
        &["launch", "+37"][..],
        &["launch", "0"],
        &["launch", "4294967296"],
        &["launch", "37 & echo"],
        &["launch", "37", "extra"],
    ] {
        let out = Command::new(env!("CARGO_BIN_EXE_polar"))
            .args(args)
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(1));
        assert!(String::from_utf8_lossy(&out.stderr).contains("Usage:"));
    }
}
