use serde::Serialize;
use std::sync::Mutex;
#[derive(Clone, Serialize)]
pub struct Session {
    pub phase: String,
    pub id: String,
    pub serial: u64,
}
impl Default for Session {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            id: String::new(),
            serial: 0,
        }
    }
}
#[derive(Default)]
pub struct Sessions(Mutex<Session>);
impl Sessions {
    pub fn snapshot(&self) -> Session {
        self.0.lock().unwrap().clone()
    }
    pub fn start(&self, id: &str) -> Result<u64, String> {
        let mut s = self.0.lock().unwrap();
        if matches!(s.phase.as_str(), "requesting" | "waiting" | "running") {
            return Err("busy".into());
        }
        s.serial += 1;
        s.id = id.into();
        s.phase = "requesting".into();
        Ok(s.serial)
    }
    pub fn phase(&self, serial: u64, phase: &str) {
        let mut s = self.0.lock().unwrap();
        if s.serial == serial {
            s.phase = phase.into()
        }
    }
}

/// Wait for a successor window after a bootstrapper exits. A short-lived
/// process alone is insufficient evidence that gameplay completed.
#[derive(Default)]
pub struct Lifetime {
    visible_since: Option<u64>,
    quiet_since: Option<u64>,
    sustained: bool,
    last_steam_running: Option<u64>,
}
impl Lifetime {
    pub fn observe_with_steam(
        &mut self,
        milliseconds: u64,
        process_alive: bool,
        steam_running: Option<bool>,
    ) -> &'static str {
        if steam_running == Some(true) {
            self.last_steam_running = Some(milliseconds);
            // An exact AppID is enough evidence even for very short games.
            self.sustained = true;
        } else if steam_running == Some(false) || process_alive {
            self.last_steam_running = None;
        } else if let Some(last) = self.last_steam_running {
            // A registry read failure alone cannot confirm that the game closed.
            return if milliseconds.saturating_sub(last) < 15_000 {
                "running"
            } else {
                "unknown"
            };
        }
        self.observe(milliseconds, process_alive || steam_running == Some(true))
    }

    pub fn observe(&mut self, milliseconds: u64, alive: bool) -> &'static str {
        if alive {
            let start = *self.visible_since.get_or_insert(milliseconds);
            self.sustained |= milliseconds.saturating_sub(start) >= 2000;
            self.quiet_since = None;
            return "running";
        }
        if self.visible_since.take().is_some() {
            self.quiet_since = Some(milliseconds)
        }
        if let Some(quiet) = self.quiet_since {
            if milliseconds.saturating_sub(quiet) < 5000 {
                return "running";
            }
            return if self.sustained { "ended" } else { "unknown" };
        }
        if milliseconds >= 45000 {
            "unknown"
        } else {
            "waiting"
        }
    }
}
