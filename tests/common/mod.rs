use std::{fs, path::Path};

pub fn library(root: &Path, config: &str) {
    let apps = root.join("steamapps");
    fs::create_dir_all(&apps).unwrap();
    fs::write(apps.join("libraryfolders.vdf"), config).unwrap();
}

pub fn manifest(root: &Path, file_id: u32, id: &str, name: &str, dir: &str, state: &str) {
    let contents = format!(
        r#""AppState" {{ "appid" "{id}" "name" "{name}" "installdir" "{dir}" "StateFlags" "{state}" }}"#
    );
    fs::write(
        root.join(format!("steamapps/appmanifest_{file_id}.acf")),
        contents,
    )
    .unwrap();
}

pub fn install(root: &Path, id: u32, name: &str) {
    manifest(root, id, &id.to_string(), name, name, "4");
    fs::create_dir_all(root.join("steamapps/common").join(name)).unwrap();
}
