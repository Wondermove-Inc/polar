use polar::catalog::{Registration, epic_scan, shortcut_target, xbox_games};
use std::fs;
use tempfile::tempdir;

#[test]
fn epic_checks_install_state_encodes_identifiers_and_isolates_bad_records() {
    let dir = tempdir().unwrap();
    let games = dir.path().join("Game");
    fs::create_dir(&games).unwrap();
    let items = dir.path().join("Manifests");
    fs::create_dir(&items).unwrap();
    let mut record = serde_json::json!({"DisplayName":"My Game","InstallLocation":games,"AppName":"a b","CatalogItemId":"catalog","CatalogNamespace":"ns","LaunchExecutable":"bin/game.exe","bIsIncompleteInstall":false});
    fs::write(items.join("one.item"), record.to_string()).unwrap();
    fs::write(items.join("bad.item"), "{").unwrap();
    record["bIsIncompleteInstall"] = true.into();
    record["AppName"] = "pending".into();
    fs::write(items.join("other.item"), record.to_string()).unwrap();
    let report = epic_scan(&items);
    assert_eq!(report.items.len(), 1);
    assert!(!report.complete);
    assert_eq!(
        report.items[0].target,
        "com.epicgames.launcher://apps/ns%3Acatalog%3Aa%20b?action=launch&silent=true"
    );
}

#[test]
fn xbox_requires_registered_id_matching_manifest_executable() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("MicrosoftGame.config"),r#"<Game><Identity Name="Studio.Game"/><ExecutableList><Executable Name="Play.exe" Id="Game"/></ExecutableList></Game>"#).unwrap();
    let rows = ["Game", "Other"].map(|id| Registration {
        id: format!("Studio.Game_publisher!{id}"),
        name: id.into(),
        root: dir.path().into(),
    });
    let found = xbox_games(&rows);
    assert_eq!(found.items.len(), 1);
    assert_eq!(found.items[0].id, "xbox:Studio.Game_publisher!Game");
}

#[test]
fn approved_shortcuts_share_steam_identity_and_cannot_forward_arbitrary_protocols() {
    assert_eq!(
        shortcut_target("steam://rungameid/620").unwrap().0,
        "steam:620"
    );
    for s in [
        "file:///C:/Windows/notepad.exe",
        "https://example.org",
        "steam://run/620//-arg",
        "steam://rungameid/0",
    ] {
        assert!(shortcut_target(s).is_none())
    }
}

#[test]
fn steam_metadata_distinguishes_games_from_tools_and_handles_truncation() {
    use std::collections::HashSet;
    let mut bytes = Vec::from([0x28, 0x44, 0x56, 0x07, 1, 0, 0, 0]);
    for (id, kind) in [(10u32, "Game"), (20, "Tool")] {
        let mut data = vec![0; 60];
        data.extend(b"\0appinfo\0\0common\0\x01type\0");
        data.extend(kind.as_bytes());
        data.extend([0, 8, 8, 8]);
        bytes.extend(id.to_le_bytes());
        bytes.extend((data.len() as u32).to_le_bytes());
        bytes.extend(data);
    }
    bytes.extend([0; 4]);
    let ids = HashSet::from([10, 20]);
    let found = polar::appinfo::categories(&bytes, &ids).unwrap();
    assert_eq!(found.get(&10), Some(&true));
    assert_eq!(found.get(&20), Some(&false));
    assert!(polar::appinfo::categories(&bytes[..11], &ids).is_none());
}

#[test]
fn xbox_drive_library_matches_registration_without_scanning_other_folders() {
    let tmp = tempdir().unwrap();
    let drive = tmp.path();
    let content = drive.join("My Games/Example/Content");
    fs::create_dir_all(&content).unwrap();
    let marker = [
        b"RGBX\x01\0\0\0".as_slice(),
        &"My Games\0"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    ]
    .concat();
    fs::write(drive.join(".GamingRoot"), marker).unwrap();
    fs::write(content.join("MicrosoftGame.config"),r#"<Game><Identity Name="Studio.Game"/><ExecutableList><Executable Id="Game" Name="Start.exe"/></ExecutableList></Game>"#).unwrap();
    let reg = Registration {
        id: "Studio.Game_publisher!Game".into(),
        name: "Demo".into(),
        root: drive.join("registration"),
    };
    let found = polar::catalog::xbox_drives(&[reg], &[drive.to_owned()]);
    assert_eq!(found.items.len(), 1);
    assert_eq!(found.items[0].root, content);
}

#[test]
fn indexed_and_sharded_steam_records_use_the_key_table() {
    use std::collections::HashSet;
    let keys = b"appinfo\0common\0type\0";
    let payload = [
        &[0u8][..],
        &0u32.to_le_bytes(),
        &[0],
        &1u32.to_le_bytes(),
        &[1],
        &2u32.to_le_bytes(),
        b"Game\0",
        &[8, 8, 8],
    ]
    .concat();
    let mut v41 = Vec::from([0x29, 0x44, 0x56, 0x07, 1, 0, 0, 0]);
    v41.extend((16u64 + 68 + payload.len() as u64).to_le_bytes());
    v41.extend(10u32.to_le_bytes());
    v41.extend((60 + payload.len() as u32).to_le_bytes());
    v41.extend([0; 60]);
    v41.extend(&payload);
    v41.extend(3u32.to_le_bytes());
    v41.extend(keys);
    let mut shard = vec![0; 44];
    shard[..4].copy_from_slice(&0x0756442au32.to_le_bytes());
    for (i, n) in [1, 16, 3, keys.len() as u32].into_iter().enumerate() {
        shard[16 + i * 4..20 + i * 4].copy_from_slice(&n.to_le_bytes())
    }
    for n in [10, 0, 20 + payload.len() as u32, 0] {
        shard.extend(n.to_le_bytes())
    }
    shard.extend(keys);
    shard.extend([0; 20]);
    shard.extend(payload);
    for bytes in [v41, shard] {
        assert!(polar::appinfo::categories(&bytes, &HashSet::from([10])).unwrap()[&10])
    }
}
