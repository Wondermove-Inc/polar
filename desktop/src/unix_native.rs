#[cfg(target_os = "linux")]
pub use polar::unix_games::artwork_id;
pub use polar::unix_games::{launch, open_platform, source};
use polar::{
    catalog::Item,
    session::{Lifetime, Sessions},
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

pub fn monitor(app: AppHandle, serial: u64, game: Item) {
    let state = app.state::<Sessions>();
    let start = Instant::now();
    let mut lifetime = Lifetime::default();
    loop {
        let phase = match polar::unix_games::processes_in(&game.root) {
            Some(alive) => lifetime.observe(start.elapsed().as_millis() as u64, alive),
            None => "unknown",
        };
        state.phase(serial, phase);
        if matches!(phase, "ended" | "unknown") {
            return;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}
