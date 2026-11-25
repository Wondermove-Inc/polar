use crate::catalog::Item;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Serialize, Deserialize, Clone)]
pub enum Approved {
    Shortcut(PathBuf),
    App(String),
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Manual {
    pub id: String,
    pub name: String,
    pub source: String,
    pub approved: Approved,
}
impl Manual {
    pub fn display(&self) -> Item {
        Item {
            id: self.id.clone(),
            name: self.name.clone(),
            source: self.source.clone(),
            target: String::new(),
            root: PathBuf::new(),
            cover: None,
            hero: None,
        }
    }
}
pub fn read_manual(path: &Path) -> Result<Vec<Manual>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}
pub fn write_manual(path: &Path, items: &[Manual]) -> Result<(), String> {
    let dir = path.parent().ok_or("Invalid data path")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut tmp, items).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
