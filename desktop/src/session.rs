use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, LPARAM, WAIT_TIMEOUT},
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
pub fn monitor(app: AppHandle, serial: u64, root: PathBuf, before: HashSet<u32>) {
    let state = app.state::<Sessions>();
    let Ok(root) = root.canonicalize() else {
        state.phase(serial, "unknown");
        return;
    };
    let start = Instant::now();
    let mut children = HashMap::new();
    let mut lifetime = polar::session::Lifetime::default();
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
        for pid in visible().difference(&before) {
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
                        .is_ok_and(|p| p.starts_with(&root));
                if matches {
                    children.insert(*pid, handle);
                } else {
                    CloseHandle(handle);
                }
            }
        }
        let phase = lifetime.observe(start.elapsed().as_millis() as u64, !children.is_empty());
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
