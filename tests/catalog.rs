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

#[test]
fn epic_uses_drive_libraries_database_and_custom_game_folder_without_central_manifests() {
    let tmp = tempdir().unwrap();
    let data = tmp.path().join("ProgramData/Epic");
    let drives = ["C", "D", "E"].map(|letter| tmp.path().join(letter));
    let extra = tmp.path().join("Other/Custom Game");
    for (root, app) in [
        (drives[1].join("Epic Games/Game D"), "d"),
        (drives[2].join("Epic Games/Game E"), "e"),
        (extra.clone(), "custom"),
    ] {
        let store = root.join(".egstore");
        fs::create_dir_all(&store).unwrap();
        let record =
            serde_json::json!({"AppName":app,"CatalogItemId":"item","CatalogNamespace":"ns"});
        fs::write(store.join("guid.mancpn"), record.to_string()).unwrap();
        fs::write(store.join("guid.manifest"), b"installed manifest").unwrap();
    }
    let store = drives[1].join("Epic Games/Incomplete/.egstore");
    fs::create_dir_all(&store).unwrap();
    fs::write(
        store.join("guid.mancpn"),
        r#"{"AppName":"incomplete","CatalogItemId":"item","CatalogNamespace":"ns"}"#,
    )
    .unwrap();
    let other = tmp.path().join("Arbitrary/Fourth");
    fs::create_dir_all(&other).unwrap();
    let db = data.join("UnrealEngineLauncher/LauncherInstalled.dat");
    fs::create_dir_all(db.parent().unwrap()).unwrap();
    let entry = |root: std::path::PathBuf, app: &str| serde_json::json!({"InstallLocation":root,"ArtifactId":app,"AppName":app,"ItemId":"item","NamespaceId":"ns"});
    let json = serde_json::json!({"InstallationList":[entry(other,"fourth"),entry(drives[1].join("Epic Games/Game D"),"d")]});
    fs::write(db, format!("\u{feff}{json}")).unwrap();
    let report = polar::catalog::epic_installations(&data, &drives, std::slice::from_ref(&extra));
    assert!(report.complete, "{:?}", report.warnings);
    let mut ids = report
        .items
        .iter()
        .map(|i| i.id.as_str())
        .collect::<Vec<_>>();
    ids.sort();
    assert_eq!(
        ids,
        [
            "epic:ns:item:custom",
            "epic:ns:item:d",
            "epic:ns:item:e",
            "epic:ns:item:fourth"
        ]
    );
    let e = report.items.iter().find(|i| i.name == "Game E").unwrap();
    assert_eq!(
        e.target,
        "com.epicgames.launcher://apps/ns%3Aitem%3Ae?action=launch&silent=true"
    );
    let manifests = data.join("EpicGamesLauncher/Data/Manifests");
    fs::create_dir_all(&manifests).unwrap();
    let pending = serde_json::json!({"DisplayName":"Game D","InstallLocation":drives[1].join("Epic Games/Game D"),"AppName":"d","CatalogItemId":"item","CatalogNamespace":"ns","LaunchExecutable":"x.exe","bIsIncompleteInstall":true});
    fs::write(manifests.join("blocked.ITEM"), pending.to_string()).unwrap();
    fs::write(manifests.join("corrupt.item"), "{").unwrap();
    let partial = polar::catalog::epic_installations(&data, &drives, &[extra]);
    assert!(!partial.complete);
    assert_eq!(partial.items.len(), 3);
    assert!(!partial.items.iter().any(|i| i.id.ends_with(":d")));
}

#[test]
fn legacy_epic_index_locates_the_install_metadata_outside_default_folders() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("Other/Legacy");
    let store = root.join(".egstore");
    fs::create_dir_all(&store).unwrap();
    fs::write(
        store.join("abc.mancpn"),
        r#"{"AppName":"legacy","CatalogItemId":"item","CatalogNamespace":"ns"}"#,
    )
    .unwrap();
    fs::write(store.join("abc.manifest"), b"manifest").unwrap();
    let db = tmp
        .path()
        .join("UnrealEngineLauncher/LauncherInstalled.dat");
    fs::create_dir_all(db.parent().unwrap()).unwrap();
    fs::write(
        db,
        serde_json::json!({"InstallationList":[{"AppName":"legacy","InstallLocation":root}]})
            .to_string(),
    )
    .unwrap();
    let scan = || polar::catalog::epic_installations(tmp.path(), &[], &[]);
    assert_eq!(scan().items[0].id, "epic:ns:item:legacy");
    fs::create_dir(store.join("Pending")).unwrap();
    fs::write(store.join("Pending/in-progress"), b"updating").unwrap();
    assert!(scan().items.is_empty());
}

#[test]
fn epic_independent_install_records_survive_stale_and_unreadable_siblings() {
    let tmp = tempdir().unwrap();
    let game = tmp.path().join("D/Epic Games/Control");
    let store = game.join(".egstore");
    fs::create_dir_all(&store).unwrap();
    let db = tmp
        .path()
        .join("UnrealEngineLauncher/LauncherInstalled.dat");
    fs::create_dir_all(db.parent().unwrap()).unwrap();
    fs::write(db,serde_json::json!({"InstallationList":[{"InstallLocation":game,"AppName":"Control","ItemId":"it","NamespaceId":"ns"}]}).to_string()).unwrap();
    fs::write(store.join("old.mancpn"), "{").unwrap();
    fs::write(store.join("old.manifest"), "old").unwrap();
    let scan = || polar::catalog::epic_installations(tmp.path(), &[tmp.path().join("D")], &[]);
    let r = scan();
    assert_eq!(r.items.len(), 1);
    assert_eq!(r.warnings.len(), 1);
    let manifests = tmp.path().join("EpicGamesLauncher/Data/Manifests");
    fs::create_dir_all(&manifests).unwrap();
    let good = serde_json::json!({"DisplayName":"Control","InstallLocation":game,"AppName":"Control","CatalogItemId":"it","CatalogNamespace":"ns","LaunchExecutable":"Control.exe"});
    let mut old = good.clone();
    old["InstallLocation"] = tmp.path().join("old").to_str().unwrap().into();
    old["bIsIncompleteInstall"] = true.into();
    for (a, b) in [(&good, &old), (&old, &good)] {
        fs::write(manifests.join("a.item"), a.to_string()).unwrap();
        fs::write(manifests.join("b.item"), b.to_string()).unwrap();
        assert_eq!(scan().items.len(), 1);
    }
}
