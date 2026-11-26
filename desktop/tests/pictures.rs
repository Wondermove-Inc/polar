use polar_desktop::pictures::{Source, resolve, screenshot_urls};
use std::{cell::Cell, io::Cursor};
const HERO: &str = "https://cdn2.steamgriddb.com/hero/0123456789abcdef0123456789abcdef.png";
const HASH: &str = "0123456789abcdef0123456789abcdef01234567";
#[test]
fn accepts_original_heroes_and_same_app_steam_screens_only() {
    assert!(Source::parse(HERO).is_some());
    for bad in [
        "https://www.steamgriddb.com/hero/123",
        &HERO.replace("/hero/", "/hero_thumb/"),
        &HERO.replace(".com/", ".com.evil/"),
        &format!("{HERO}?x"),
        "steam:0",
    ] {
        assert!(Source::parse(bad).is_none(), "{bad}");
    }
    let root = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
    let full = format!("{root}/20/ss_{HASH}.1920x1080.jpg?t=3");
    let wrong = full.replace("/20/", "/30/");
    let json = serde_json::json!({"20":{"success":true,"data":{"type":"game","steam_appid":20,"screenshots":[{"path_full":wrong},{"path_full":full}]}}});
    let urls = screenshot_urls(20, &json);
    assert_eq!(urls.first(), Some(&format!("{root}/20/ss_{HASH}.jpg")));
    assert!(urls.iter().all(|u| u.contains("/20/")));
}
#[test]
fn modern_steam_asset_directory_belongs_to_the_selected_game() {
    let base = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1808500";
    let shot = format!("ss_{HASH}.1920x1080.jpg");
    let valid = format!("{base}/{HASH}/{shot}");
    let candidates = [
        format!("{base}/misc/{shot}"),
        format!("{base}/{HASH}/{HASH}/{shot}"),
        valid.replace("1808500", "20"),
        valid,
    ];
    let shots: Vec<_> = candidates
        .into_iter()
        .map(|path| serde_json::json!({"path_full":path}))
        .collect();
    let doc = serde_json::json!({"1808500":{"success":true,"data":{"type":"game","steam_appid":1808500,"screenshots":shots}}});
    assert_eq!(
        screenshot_urls(1808500, &doc),
        vec![format!("{base}/{HASH}/ss_{HASH}.jpg")]
    );
}
#[test]
fn only_valid_hd_content_is_committed_and_offline_reads_never_fetch() {
    let temp = tempfile::tempdir().unwrap();
    let source = Source::parse(HERO).unwrap();
    let mut encoded = Cursor::new(Vec::new());
    image::GrayImage::new(1920, 1080)
        .write_to(&mut encoded, image::ImageFormat::Png)
        .unwrap();
    let body = encoded.into_inner();
    let calls = Cell::new(0);
    let get = |_: &str, _: usize| {
        calls.set(calls.get() + 1);
        Ok(body.clone())
    };
    assert!(
        resolve(temp.path(), &source, false, &get)
            .unwrap()
            .is_none()
    );
    assert!(
        resolve(temp.path(), &source, true, &|_, _| Ok(body[..64].to_vec()))
            .unwrap()
            .is_none()
    );
    assert!(resolve(temp.path(), &source, true, &get).unwrap().is_some());
    assert!(
        resolve(temp.path(), &source, false, &get)
            .unwrap()
            .is_some()
    );
    assert_eq!(calls.get(), 1);
}

#[test]
#[ignore = "reads current public Steam and SteamGridDB data"]
fn live_store_4k_and_community_original() {
    use polar_desktop::pictures::{download, search};
    let dir = tempfile::tempdir().unwrap();
    let korean = search("데이브 더 다이버", "ko").unwrap();
    assert!(korean.iter().any(|h| h.id == 1868140));
    let hits = search("Forza Horizon 5", "en").unwrap();
    assert!(hits.iter().any(|h| h.id == 1551360));
    let source = Source::parse("steam:1551360").unwrap();
    let pic = resolve(dir.path(), &source, true, &download)
        .unwrap()
        .unwrap();
    let url = pic.data_url();
    assert!(url.starts_with("data:image/jpeg;base64,"));
    assert_eq!(
        resolve(dir.path(), &source, false, &|_, _| panic!(
            "offline request"
        ))
        .unwrap()
        .unwrap()
        .data_url(),
        url
    );
    let data = std::fs::read(dir.path().join("steam-1551360.art")).unwrap();
    assert_eq!(
        image::ImageReader::new(Cursor::new(&data))
            .with_guessed_format()
            .unwrap()
            .into_dimensions()
            .unwrap(),
        (3840, 2160)
    );
    let modern = Source::parse("steam:1808500").unwrap();
    assert!(
        resolve(dir.path(), &modern, true, &download)
            .unwrap()
            .is_some()
    );
    let banner = download(
        "https://cdn2.steamgriddb.com/hero/eb6d4c011e1c97b5b498fbbe105bc232.png",
        12 * 1024 * 1024,
    )
    .unwrap();
    assert!(polar_desktop::pictures::Photo::decode(banner).is_none());
}

#[test]
fn picks_best_of_store_originals_and_evicts_old_managed_art() {
    use std::fs;
    let dir = tempfile::tempdir().unwrap();
    fs::File::create(dir.path().join("old.art"))
        .unwrap()
        .set_len(128 * 1024 * 1024)
        .unwrap();
    fs::write(dir.path().join("keep.txt"), b"unrelated").unwrap();
    let root = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/20/ss_";
    let shots: Vec<_> = ["1", "2", "3", "4"]
        .into_iter()
        .map(|d| serde_json::json!({"path_full":format!("{root}{}.1920x1080.jpg",d.repeat(40))}))
        .collect();
    let doc = serde_json::json!({"20":{"success":true,"data":{"type":"game","steam_appid":20,"screenshots":shots}}});
    let get = |url: &str, _: usize| {
        if url.starts_with("https://store.steampowered.com/") {
            return Ok(serde_json::to_vec(&doc).unwrap());
        }
        let (w, h) = if url.contains("ss_11") {
            (1920, 620)
        } else if url.contains("ss_22") {
            (1920, 1080)
        } else if url.contains("ss_33") {
            (2560, 1440)
        } else {
            panic!("unexpected URL {url}")
        };
        let mut image = Cursor::new(Vec::new());
        image::GrayImage::new(w, h)
            .write_to(&mut image, image::ImageFormat::Png)
            .unwrap();
        Ok(image.into_inner())
    };
    let source = Source::parse("steam:20").unwrap();
    assert!(resolve(dir.path(), &source, true, &get).unwrap().is_some());
    assert!(!dir.path().join("old.art").exists());
    assert!(dir.path().join("keep.txt").exists());
    assert_eq!(
        image::ImageReader::open(dir.path().join("steam-20.art"))
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .into_dimensions()
            .unwrap(),
        (2560, 1440)
    );
}

#[test]
fn steam_supplies_a_native_panorama_and_portrait_when_local_art_is_missing() {
    let tmp = tempfile::tempdir().unwrap();
    for (source, asset, width, height) in [
        (Source::Steam(363150), "library_hero.jpg", 1920, 620),
        (Source::Cover(1091500), "library_600x900_2x.jpg", 600, 900),
    ] {
        let get = |url: &str, _: usize| {
            if !url.ends_with(asset) {
                return Err("unavailable".into());
            }
            let mut encoded = Cursor::new(Vec::new());
            image::GrayImage::new(width, height)
                .write_to(&mut encoded, image::ImageFormat::Png)
                .unwrap();
            Ok(encoded.into_inner())
        };
        assert!(resolve(tmp.path(), &source, true, &get).unwrap().is_some());
        assert!(
            resolve(tmp.path(), &source, false, &|_, _| panic!("offline"))
                .unwrap()
                .is_some()
        );
    }
}

#[test]
fn uses_the_matching_steam_store_items_hashed_portrait_and_caches_it_offline() {
    let dir = tempfile::tempdir().unwrap();
    let expected = format!(
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3280350/{HASH}/library_capsule_2x.jpg"
    );
    let documents = serde_json::json!({"response":{"store_items":[
        {"appid":42,"assets":{"library_capsule_2x":"library_600x900_2x.jpg"}},
        {"appid":3280350,"assets":{"library_capsule_2x":format!("{HASH}/library_capsule_2x.jpg")}}
    ]}});
    let mut encoded = Cursor::new(Vec::new());
    image::GrayImage::new(600, 900)
        .write_to(&mut encoded, image::ImageFormat::Png)
        .unwrap();
    let get = |url: &str, _: usize| {
        if url.starts_with("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/") {
            let request = url::Url::parse(url).unwrap();
            let payload: serde_json::Value = serde_json::from_str(
                &request
                    .query_pairs()
                    .find(|(k, _)| k == "input_json")
                    .unwrap()
                    .1,
            )
            .unwrap();
            assert_eq!(payload["ids"][0]["appid"], 3280350);
            assert_eq!(payload["data_request"]["include_assets"], true);
            return Ok(serde_json::to_vec(&documents).unwrap());
        }
        assert_eq!(url, expected);
        Ok(encoded.get_ref().clone())
    };
    let source = Source::Cover(3280350);
    assert!(resolve(dir.path(), &source, true, &get).unwrap().is_some());
    assert!(
        resolve(dir.path(), &source, false, &|_, _| panic!(
            "offline network"
        ))
        .unwrap()
        .is_some()
    );
}

#[test]
fn invalid_cover_metadata_can_only_fall_back_to_the_same_games_standard_assets() {
    let dir = tempfile::tempdir().unwrap();
    let doc = serde_json::json!({"response":{"store_items":[
        {"appid":99,"assets":{"library_capsule":"library_capsule.jpg"}},
        {"appid":20,"assets":{"library_capsule_2x":"../99/library_600x900.jpg",
                                     "library_capsule":"https://example.com/library_capsule.jpg"}}
    ]}});
    let get = |url: &str, _: usize| {
        if url.starts_with("https://api.steampowered.com/") {
            return Ok(serde_json::to_vec(&doc).unwrap());
        }
        let prefix = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/20/";
        assert!(matches!(
            url.strip_prefix(prefix),
            Some("library_600x900_2x.jpg" | "library_600x900.jpg")
        ));
        Err("unavailable".into())
    };
    assert!(
        resolve(dir.path(), &Source::Cover(20), true, &get)
            .unwrap()
            .is_none()
    );
}

#[test]
#[ignore = "retrieves the publisher's current capsule from Steam"]
fn live_covers_for_reported_missing_posters() {
    use polar_desktop::pictures::download;
    let dir = tempfile::tempdir().unwrap();
    for app in [3280350, 4128400] {
        assert!(
            resolve(dir.path(), &Source::Cover(app), true, &download)
                .unwrap()
                .is_some(),
            "{app}"
        );
        let dimensions = image::ImageReader::open(dir.path().join(format!("cover-{app}.art")))
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .into_dimensions()
            .unwrap();
        assert_eq!(dimensions, (600, 900));
        eprintln!("{app}: {} x {}", dimensions.0, dimensions.1);
    }
}
