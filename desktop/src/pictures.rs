//! Game artwork from the Steam store and user-selected SteamGridDB originals.
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{Cursor, Read, Write},
    path::Path,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use url::Url;

const MIB: usize = 1024 * 1024;
pub const IMAGE_LIMIT: usize = 12 * MIB;
const CACHE_LIMIT: u64 = 128 * MIB as u64;
const HERO_PREFIX: &str = "https://cdn2.steamgriddb.com/hero/";

pub enum Source {
    Steam(u32),
    Hero(String),
}
fn hex(s: &str, length: usize) -> bool {
    s.len() == length && s.bytes().all(|b| b.is_ascii_hexdigit())
}
impl Source {
    pub fn parse(s: &str) -> Option<Self> {
        if let Some(id) = s.strip_prefix("steam:") {
            let id: u32 = id.parse().ok()?;
            return (id != 0 && s == format!("steam:{id}")).then_some(Self::Steam(id));
        }
        let name = s.strip_prefix(HERO_PREFIX)?;
        let (hash, ext) = name.split_once('.')?;
        (hex(hash, 32) && matches!(ext, "png" | "jpg" | "webp")).then(|| Self::Hero(name.into()))
    }
    fn key(&self) -> String {
        match self {
            Self::Steam(id) => format!("steam-{id}"),
            Self::Hero(name) => format!("hero-{name}"),
        }
    }
}

pub fn screenshot_urls(app: u32, doc: &Value) -> Vec<String> {
    let entry = &doc[app.to_string()];
    let data = &entry["data"];
    if entry["success"] != true || data["steam_appid"] != app || data["type"] != "game" {
        return vec![];
    }
    let mut urls = vec![];
    for shot in data["screenshots"].as_array().into_iter().flatten() {
        let Some(full) = shot["path_full"].as_str().and_then(|s| Url::parse(s).ok()) else {
            continue;
        };
        let Some(
            host @ ("shared.akamai.steamstatic.com"
            | "shared.fastly.steamstatic.com"
            | "shared.steamstatic.com"
            | "cdn.akamai.steamstatic.com"),
        ) = full.host_str()
        else {
            continue;
        };
        if full.scheme() != "https" {
            continue;
        }
        let Some((dir, name)) = full.path().rsplit_once('/') else {
            continue;
        };
        // New Steam uploads add a hash directory beneath the same App ID.
        let app_dir = dir
            .rsplit_once('/')
            .filter(|(_, leaf)| hex(leaf, 40))
            .map_or(dir, |(parent, _)| parent);
        if app_dir != format!("/store_item_assets/steam/apps/{app}")
            && app_dir != format!("/steam/apps/{app}")
        {
            continue;
        }
        let Some((hash, suffix)) = name.strip_prefix("ss_").and_then(|s| s.split_once('.')) else {
            continue;
        };
        if !hex(hash, 40)
            || !(suffix == "jpg"
                || suffix
                    .strip_suffix(".jpg")
                    .and_then(|v| v.split_once('x'))
                    .is_some_and(|(w, h)| [w, h].iter().all(|n| n.parse::<u16>().is_ok())))
        {
            continue;
        }
        let original = format!("https://{host}{dir}/ss_{hash}.jpg");
        if !urls.contains(&original) {
            urls.push(original)
        }
        if urls.len() == 3 {
            break;
        }
    }
    urls
}

pub fn download(url: &str, limit: usize) -> Result<Vec<u8>, String> {
    static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
        ureq::Agent::config_builder()
            .max_redirects(0)
            .timeout_global(Some(Duration::from_secs(5)))
            .build()
            .into()
    });
    let mut response = AGENT
        .get(url)
        .header("User-Agent", "Polar/1.0 (personal game launcher)")
        .call()
        .map_err(|_| "network")?;
    if response.status() != 200 {
        return Err("network".into());
    }
    response
        .body_mut()
        .with_config()
        .limit(limit as u64)
        .read_to_vec()
        .map_err(|_| "network".into())
}

#[derive(Deserialize, Serialize)]
pub struct SearchHit {
    pub id: u32,
    pub name: String,
}
pub fn search(title: &str, lang: &str) -> Result<Vec<SearchHit>, String> {
    if title.trim().is_empty() || title.chars().count() > 180 {
        return Err("title".into());
    }
    let (language, region) = match lang {
        "ko" => ("koreana", "KR"),
        "en" => ("english", "US"),
        _ => return Err("language".into()),
    };
    let mut url = Url::parse("https://store.steampowered.com/api/storesearch/").unwrap();
    url.query_pairs_mut()
        .append_pair("term", title)
        .append_pair("l", language)
        .append_pair("cc", region);
    let doc: Value =
        serde_json::from_slice(&download(url.as_str(), MIB)?).map_err(|_| "network")?;
    Ok(doc["items"]
        .as_array()
        .ok_or("network")?
        .iter()
        .filter(|v| v["type"] == "app")
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .take(10)
        .collect())
}

pub struct Photo {
    bytes: Vec<u8>,
    format: ImageFormat,
    width: u32,
    height: u32,
}
impl Photo {
    pub fn data_url(&self) -> String {
        format!(
            "data:{};base64,{}",
            self.format.to_mime_type(),
            STANDARD.encode(&self.bytes)
        )
    }
    fn fit(&self) -> u64 {
        (u64::from(self.width) * 9).min(u64::from(self.height) * 16)
    }
    pub fn decode(bytes: Vec<u8>) -> Option<Self> {
        if bytes.len() > IMAGE_LIMIT {
            return None;
        }
        let reader = ImageReader::new(Cursor::new(&bytes))
            .with_guessed_format()
            .ok()?;
        let format = reader.format()?;
        let (width, height) = reader.into_dimensions().ok()?;
        if width < 1920
            || height < 1080
            || width <= height
            || width > 8192
            || height > 8192
            || u64::from(width) * u64::from(height) > 32_000_000
        {
            return None;
        }
        let mut reader = ImageReader::with_format(Cursor::new(&bytes), format);
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(128 * MIB as u64);
        reader.limits(limits);
        reader.decode().ok()?;
        Some(Self {
            bytes,
            format,
            width,
            height,
        })
    }
}

fn store(dir: &Path, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    static WRITES: Mutex<()> = Mutex::new(());
    let _guard = WRITES.lock().unwrap();
    fs::create_dir_all(dir)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)? {
        let p = entry?.path();
        if p.extension().is_some_and(|e| e == "art") && p != path {
            let meta = p.symlink_metadata()?;
            if meta.is_file() {
                entries.push((meta.modified()?, meta.len(), p));
            }
        }
    }
    entries.sort_unstable();
    let mut total = bytes.len() as u64 + entries.iter().map(|e| e.1).sum::<u64>();
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(bytes)?;
    for (_, size, p) in entries {
        if total <= CACHE_LIMIT {
            break;
        }
        fs::remove_file(p)?;
        total -= size;
    }
    tmp.persist(path)?;
    Ok(())
}

pub fn resolve(
    dir: &Path,
    source: &Source,
    online: bool,
    get: &impl Fn(&str, usize) -> Result<Vec<u8>, String>,
) -> Result<Option<Photo>, String> {
    let path = dir.join(format!("{}.art", source.key()));
    if let Ok(file) = fs::File::open(&path) {
        let mut bytes = Vec::new();
        if file
            .take(IMAGE_LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .is_ok()
            && let Some(photo) = Photo::decode(bytes)
        {
            return Ok(Some(photo));
        }
    }
    if !online {
        return Ok(None);
    }
    let start = Instant::now();
    let urls = match source {
        Source::Hero(name) => vec![format!("{HERO_PREFIX}{name}")],
        Source::Steam(id) => {
            let raw = get(
                &format!("https://store.steampowered.com/api/appdetails?appids={id}&l=english"),
                4 * MIB,
            )?;
            screenshot_urls(*id, &serde_json::from_slice(&raw).map_err(|_| "network")?)
        }
    };
    let mut best: Option<Photo> = None;
    for url in urls {
        if start.elapsed() > Duration::from_secs(12) {
            break;
        }
        let Some(photo) = get(&url, IMAGE_LIMIT).ok().and_then(Photo::decode) else {
            continue;
        };
        if best.as_ref().is_none_or(|b| photo.fit() > b.fit()) {
            best = Some(photo)
        }
        if best
            .as_ref()
            .is_some_and(|b| b.width >= 3840 && b.height >= 2160)
        {
            break;
        }
    }
    if let Some(photo) = &best {
        // A full or read-only cache must not hide a usable online picture.
        let _ = store(dir, &path, &photo.bytes);
    }
    Ok(best)
}
