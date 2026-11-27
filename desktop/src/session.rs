use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, HWND, LPARAM, WAIT_TIMEOUT},
    System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        QueryFullProcessImageNameW, WaitForSingleObject,
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GetDesktopWindow, GetForegroundWindow, GetShellWindow,
        GetWindowThreadProcessId, IsWindowVisible,
    },
};

pub use polar::session::{Session, Sessions};
use winreg::{RegKey, enums::HKEY_CURRENT_USER};

pub fn steam_running(app_id: u32) -> Option<bool> {
    let path = format!(r"Software\Valve\Steam\Apps\{app_id}");
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey(path).ok()?;
    key.get_value::<u32, _>("Running").ok().map(|v| v != 0)
}

unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> i32 {
    unsafe {
        if IsWindowVisible(hwnd) != 0 {
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            (*(data as *mut HashSet<u32>)).insert(pid);
        }
    }
    1
}
pub fn visible() -> HashSet<u32> {
    let mut ids = HashSet::<u32>::new();
    unsafe {
        EnumWindows(Some(collect), (&mut ids as *mut HashSet<u32>) as isize);
    }
    ids
}
fn collect_game_handles(root: &Path, before: &HashSet<u32>, children: &mut HashMap<u32, HANDLE>) {
    for pid in visible().difference(before) {
        if children.contains_key(pid) {
            continue;
        }
        unsafe {
            let handle = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                *pid,
            );
            if handle.is_null() {
                continue;
            }
            let mut buf = vec![0u16; 32768];
            let mut len = buf.len() as u32;
            let read = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len) != 0;
            let matches = read
                && Path::new(&String::from_utf16_lossy(&buf[..len as usize]))
                    .canonicalize()
                    .is_ok_and(|p| p.starts_with(root));
            if matches {
                children.insert(*pid, handle);
            } else {
                CloseHandle(handle);
            }
        }
    }
}

pub fn monitor(
    app: AppHandle,
    serial: u64,
    root: Option<PathBuf>,
    before: HashSet<u32>,
    steam_app: Option<u32>,
    steam_was_running: bool,
) {
    let state = app.state::<Sessions>();
    let root = root.and_then(|p| p.canonicalize().ok());
    if root.is_none() && steam_app.is_none() {
        state.phase(serial, "unknown");
        return;
    }
    let start = Instant::now();
    let mut children = HashMap::new();
    let mut lifetime = polar::session::Lifetime::default();
    if steam_was_running {
        lifetime.observe_with_steam(0, false, Some(true));
    }
    loop {
        children.retain(|_, handle| {
            // Keep tracking a minimized or temporarily hidden game until its process exits.
            unsafe {
                if WaitForSingleObject(*handle, 0) == WAIT_TIMEOUT {
                    true
                } else {
                    CloseHandle(*handle);
                    false
                }
            }
        });
        if let Some(root) = &root {
            collect_game_handles(root, &before, &mut children);
        }
        let phase = lifetime.observe_with_steam(
            start.elapsed().as_millis() as u64,
            !children.is_empty(),
            steam_app.and_then(steam_running),
        );
        state.phase(serial, phase);
        if phase == "ended" || phase == "unknown" {
            let shell_active = unsafe {
                let fg = GetForegroundWindow();
                fg.is_null() || fg == GetShellWindow() || fg == GetDesktopWindow()
            };
            if phase == "ended"
                && shell_active
                && let Some(w) = app.get_webview_window("main")
            {
                let _ = w.set_focus();
            }
            return;
        }
        std::thread::sleep(Duration::from_millis(450));
    }
}
