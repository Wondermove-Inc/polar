use polar::catalog::{Registration, Report};
pub use polar::saved::{Approved, Manual, read_manual, write_manual};
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};
use windows_sys::{
    Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    w,
};
use winreg::{RegKey, enums::*};

fn ps(script: &str, key: &str, val: &std::ffi::OsStr) -> Result<Vec<u8>, String> {
    let exe = std::env::var_os("SystemRoot").ok_or("SystemRoot")?;
    use std::{
        io::{Read, Seek},
        os::windows::io::AsRawHandle,
    };
    use windows_sys::Win32::{Foundation::WAIT_OBJECT_0, System::Threading::WaitForSingleObject};
    let execute = || -> std::io::Result<(bool, Vec<u8>)> {
        // Files avoid blocking on a full pipe while the native wait enforces a deadline.
        let stdout = tempfile::tempfile()?;
        let stderr = tempfile::tempfile()?;
        let mut child =
            Command::new(PathBuf::from(exe).join("System32/WindowsPowerShell/v1.0/powershell.exe"))
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    script,
                ])
                .env(key, val)
                .creation_flags(0x08000000)
                .stdin(std::process::Stdio::null())
                .stdout(stdout.try_clone()?)
                .stderr(stderr.try_clone()?)
                .spawn()?;
        if unsafe { WaitForSingleObject(child.as_raw_handle(), 30_000) } != WAIT_OBJECT_0 {
            let _ = child.kill();
            child.wait()?;
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Windows application query timed out",
            ));
        }
        let ok = child.wait()?.success();
        let mut file = if ok { stdout } else { stderr };
        file.rewind()?;
        let mut data = Vec::new();
        file.take(16 * 1024 * 1024 + 1).read_to_end(&mut data)?;
        if data.len() > 16 * 1024 * 1024 {
            return Err(std::io::Error::other("Windows application list too large"));
        }
        Ok((ok, data))
    };
    let (ok, data) = execute().map_err(|e| e.to_string())?;
    if !ok {
        return Err(String::from_utf8_lossy(&data).trim().to_owned());
    }
    Ok(data)
}
pub fn registrations(games: bool) -> Result<Vec<Registration>, String> {
    let out = ps(
        include_str!("registered.ps1"),
        "POLAR_QUERY",
        if games { "games" } else { "apps" }.as_ref(),
    )?;
    serde_json::from_slice(&out).map_err(|e| e.to_string())
}
pub fn source(name: &str) -> Report {
    match name {
        "steam" => polar::catalog::steam_scan(),
        "epic" => match std::env::var_os("ProgramData") {
            Some(root) => polar::catalog::epic_scan(
                &PathBuf::from(root).join("Epic/EpicGamesLauncher/Data/Manifests"),
            ),
            None => Report::failure("ProgramData".into()),
        },
        "xbox" => match registrations(true) {
            Ok(rows) => {
                use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
                let mask = unsafe { GetLogicalDrives() };
                let mut drives = Vec::new();
                for index in 0..26u8 {
                    if mask & (1 << index) == 0 {
                        continue;
                    }
                    let letter = b'A' + index;
                    let wide = [letter as u16, 58, 92, 0];
                    // DRIVE_REMOVABLE and DRIVE_FIXED only; skip network mounts.
                    if matches!(unsafe { GetDriveTypeW(wide.as_ptr()) }, 2 | 3) {
                        drives.push(PathBuf::from(format!("{}:\\", letter as char)))
                    }
                }
                polar::catalog::xbox_drives(&rows, &drives)
            }
            Err(e) => Report::failure(e),
        },
        _ => Report::failure("Unknown source".into()),
    }
}
pub fn shell(target: &std::ffi::OsStr) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = target.encode_wide().chain([0]).collect();
    if wide[..wide.len() - 1].contains(&0) {
        return Err("Invalid target".into());
    }
    if target.to_string_lossy().starts_with("shell:AppsFolder") {
        use windows_sys::Win32::{
            System::Com::{
                COINIT_APARTMENTTHREADED, CoInitializeEx, CoTaskMemFree, CoUninitialize,
            },
            UI::Shell::{
                SEE_MASK_IDLIST, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW, SHParseDisplayName,
                ShellExecuteExW,
            },
        };
        // Activate AppsFolder namespace entries by PIDL, including packaged apps without a file path.
        unsafe {
            let initialized =
                CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) >= 0;
            let mut pidl = std::ptr::null_mut();
            let hr = SHParseDisplayName(
                wide.as_ptr(),
                std::ptr::null_mut(),
                &mut pidl,
                0,
                std::ptr::null_mut(),
            );
            let result = if hr < 0 {
                Err(format!("AppsFolder HRESULT {hr:#x}"))
            } else {
                let mut info = SHELLEXECUTEINFOW {
                    cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                    fMask: SEE_MASK_IDLIST | SEE_MASK_NOASYNC,
                    lpIDList: pidl.cast(),
                    nShow: SW_SHOWNORMAL,
                    ..Default::default()
                };
                let ok = ShellExecuteExW(&mut info) != 0;
                let err = std::io::Error::last_os_error();
                CoTaskMemFree(pidl.cast());
                if ok { Ok(()) } else { Err(err.to_string()) }
            };
            if initialized {
                CoUninitialize()
            }
            return result;
        }
    }
    // The native target is produced by discovery or a user-approved file picker.
    let code = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            w!("open"),
            wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if code <= 32 {
        return Err(format!("ShellExecuteW ({code})"));
    }
    Ok(())
}
const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
fn run_entry() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| format!("\"{}\"", p.display()))
        .map_err(|e| e.to_string())
}
pub fn login() -> Result<bool, String> {
    match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN)
        .and_then(|k| k.get_value::<String, _>("PolarLauncher"))
    {
        Ok(value) => Ok(value == run_entry()?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}
pub fn set_login(enable: bool) -> Result<(), String> {
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(RUN)
        .map_err(|e| e.to_string())?
        .0;
    let ours = run_entry()?;
    match key.get_value::<String, _>("PolarLauncher") {
        Ok(existing) if existing != ours => {
            return Err("Run entry belongs to another installation".into());
        }
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
        Err(_) if !enable => return Ok(()),
        _ => {}
    }
    if enable {
        key.set_value("PolarLauncher", &ours)
    } else {
        key.delete_value("PolarLauncher")
    }
    .map_err(|e| e.to_string())
}

pub fn shortcut(path: &Path) -> Result<(String, String), String> {
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.is_file() {
        return Err("Missing shortcut".into());
    }
    let ext = canonical.extension().and_then(|s| s.to_str()).unwrap_or("");
    if ext.eq_ignore_ascii_case("url") {
        let bytes = fs::read(&canonical).map_err(|e| e.to_string())?;
        let text = if bytes.starts_with(&[255, 254]) {
            String::from_utf16_lossy(
                &bytes[2..]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .copied()
                    .map(u16::from_le_bytes)
                    .collect::<Vec<_>>(),
            )
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        };
        return text
            .lines()
            .find_map(|l| {
                l.trim()
                    .split_once('=')
                    .filter(|(k, _)| k.eq_ignore_ascii_case("URL"))
                    .and_then(|(_, v)| polar::catalog::shortcut_target(v.trim()))
            })
            .ok_or("Unsupported game URL".into());
    }
    if !ext.eq_ignore_ascii_case("lnk") {
        return Err("Select a .lnk or a game .url file".into());
    }
    let display = path.to_str().ok_or("Unsupported path")?.to_owned();
    let mut id = format!("shortcut:{}", canonical.to_string_lossy().to_lowercase());
    // Common Steam and registered-app shortcuts have the same identity as auto discovery.
    let script = r#"$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:POLAR_LINK);ConvertTo-Json -Compress @([string]$s.TargetPath,[string]$s.Arguments)"#;
    if let Ok(out) = ps(script, "POLAR_LINK", path.as_os_str())
        && let Ok([exe, args]) = serde_json::from_slice::<[String; 2]>(&out)
    {
        let words: Vec<_> = args.split_whitespace().collect();
        if Path::new(&exe)
            .file_name()
            .is_some_and(|x| x.eq_ignore_ascii_case("steam.exe"))
            && let ["-applaunch", raw] = words.as_slice()
            && let Some(n) = polar::parse_id(raw)
        {
            id = format!("steam:{n}")
        }
        if let Some((key, _)) = polar::catalog::shortcut_target(args.trim_matches('"')) {
            id = key
        }
        if let Some(app) = args.trim_matches('"').strip_prefix("shell:AppsFolder\\") {
            id = format!("xbox:{app}")
        }
    }
    Ok((id, display))
}

pub fn pick_link(owner: windows_sys::Win32::Foundation::HWND) -> Result<Option<PathBuf>, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::UI::Controls::Dialogs::*;
    let mut buf = vec![0u16; 32768];
    let filter: Vec<u16> = "*.lnk, *.url\0*.lnk;*.url\0\0".encode_utf16().collect();
    let mut options = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: owner,
        lpstrFilter: filter.as_ptr(),
        lpstrFile: buf.as_mut_ptr(),
        nMaxFile: buf.len() as u32,
        Flags: OFN_EXPLORER
            | OFN_NOCHANGEDIR
            | OFN_FILEMUSTEXIST
            | OFN_PATHMUSTEXIST
            | OFN_NODEREFERENCELINKS,
        ..Default::default()
    };
    // The file itself is approved; Windows must not resolve it to its target executable.
    if unsafe { GetOpenFileNameW(&mut options) } == 0 {
        let err = unsafe { CommDlgExtendedError() };
        return if err == 0 {
            Ok(None)
        } else {
            Err(format!("File picker: {err}"))
        };
    }
    let len = buf
        .iter()
        .position(|&c| c == 0)
        .ok_or("Invalid file selection")?;
    Ok(Some(std::ffi::OsString::from_wide(&buf[..len]).into()))
}
