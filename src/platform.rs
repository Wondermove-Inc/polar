use std::path::PathBuf;

#[cfg(windows)]
pub fn registered_root() -> Result<PathBuf, String> {
    use winreg::{RegKey, enums::*};
    let sources = [
        (
            HKEY_CURRENT_USER,
            r"Software\Valve\Steam",
            "SteamPath",
            KEY_READ,
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Valve\Steam",
            "InstallPath",
            KEY_READ | KEY_WOW64_32KEY,
        ),
    ];
    let mut errors = Vec::new();
    for (hive, key, name, flags) in sources {
        match RegKey::predef(hive)
            .open_subkey_with_flags(key, flags)
            .and_then(|k| k.get_value::<std::ffi::OsString, _>(name))
        {
            Ok(path) if PathBuf::from(&path).is_absolute() => return Ok(path.into()),
            Ok(_) => errors.push(format!("{key}/{name}: expected an absolute Steam path")),
            Err(e) => errors.push(format!("{key}/{name}: {e}")),
        }
    }
    Err(errors.join("\n"))
}

#[cfg(windows)]
pub(super) fn open_uri(uri: &str) -> Result<(), String> {
    use std::ptr::null;
    use windows_sys::{
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        w,
    };
    let url: Vec<u16> = uri.encode_utf16().chain(Some(0)).collect();
    // Both strings are NUL-terminated and remain alive through the synchronous call.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            w!("open"),
            url.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result > 32 {
        Ok(())
    } else {
        Err(format!(
            "Steam URI handler returned ShellExecuteW code {result}"
        ))
    }
}

#[cfg(not(windows))]
pub fn registered_root() -> Result<PathBuf, String> {
    Err("Steam registry discovery requires Windows; use --steam-root <path> list to inspect a library.".into())
}

#[cfg(not(windows))]
pub(super) fn open_uri(_: &str) -> Result<(), String> {
    Err("Steam launch requires Windows.".into())
}
