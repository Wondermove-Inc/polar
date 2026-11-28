//! Read icon frames without launching a shortcut or loading a game as executable code.
use image::{ImageFormat, ImageReader, Limits};
use std::io::Cursor;

const MAX_BYTES: usize = 4 * 1024 * 1024;

fn from_ico(bytes: &[u8]) -> Option<Vec<u8>> {
    best_frame(bytes, 16, |entry| {
        let start = u32::from_le_bytes(entry[12..16].try_into().ok()?) as usize;
        let len = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
        bytes.get(start..start.checked_add(len)?)
    })
}

// Older 32-bit BI_RGB icons can leave every alpha byte zero and put opacity in the AND mask.
fn legacy_mask_visible(dib: &[u8], width: u32) -> bool {
    if dib.len() < 40 || dib[14..16] != 32u16.to_le_bytes() || dib[16..20] != [0; 4] {
        return false;
    }
    let header = u32::from_le_bytes(dib[..4].try_into().unwrap()) as usize;
    let colors = u32::from_le_bytes(dib[32..36].try_into().unwrap()) as usize;
    let width = width as usize;
    let Some(start) = colors
        .checked_mul(4)
        .and_then(|n| header.checked_add(n))
        .and_then(|n| n.checked_add(width * width * 4))
    else {
        return false;
    };
    let stride = width.div_ceil(32) * 4;
    let Some(mask) = dib.get(start..).and_then(|data| data.get(..width * stride)) else {
        return false;
    };
    mask.chunks_exact(stride)
        .any(|row| (0..width).any(|x| row[x / 8] & (0x80 >> (x % 8)) == 0))
}

// ICO directories and Windows RT_GROUP_ICON share the first 12 bytes of each entry.
// The remainder is either a file offset (ICO) or an RT_ICON resource ID (PE).
fn best_frame<'a>(
    directory: &[u8],
    stride: usize,
    data: impl Fn(&[u8]) -> Option<&'a [u8]>,
) -> Option<Vec<u8>> {
    if directory.get(..4)? != [0, 0, 1, 0] {
        return None;
    }
    let count = u16::from_le_bytes(directory.get(4..6)?.try_into().ok()?) as usize;
    if count > 128 {
        return None;
    }
    let mut entries: Vec<_> = directory
        .get(6..6 + count * stride)?
        .chunks_exact(stride)
        .filter(|e| e[0] == e[1])
        .collect();
    entries.sort_by_key(|e| {
        std::cmp::Reverse((
            if e[0] == 0 { 256 } else { u16::from(e[0]) },
            u16::from_le_bytes([e[6], e[7]]),
        ))
    });
    let mut best = None;
    let mut best_width = 0;
    for entry in entries {
        if entry[0] != 0 && u32::from(entry[0]) <= best_width {
            break;
        }
        let Some(frame) = data(entry) else { continue };
        let len = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
        if frame.len() != len || len == 0 || len > MAX_BYTES {
            continue;
        }
        let mut single = Vec::with_capacity(22 + len);
        single.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
        single.extend_from_slice(&entry[..12]);
        single.extend_from_slice(&22u32.to_le_bytes());
        single.extend_from_slice(frame);
        let (input, format) = if frame.starts_with(b"\x89PNG\r\n\x1a\n") {
            (frame, ImageFormat::Png)
        } else {
            (single.as_slice(), ImageFormat::Ico)
        };
        let mut reader = ImageReader::with_format(Cursor::new(input), format);
        let mut limits = Limits::default();
        limits.max_image_width = Some(1024);
        limits.max_image_height = Some(1024);
        limits.max_alloc = Some(16 * 1024 * 1024);
        reader.limits(limits);
        let Ok(image) = reader.decode() else { continue };
        let width = image.width();
        if width == image.height()
            && width > best_width
            && (if width >= 256 { 0 } else { width as u8 }) == entry[0]
            && (image.into_rgba8().pixels().any(|p| p[3] != 0)
                || (format == ImageFormat::Ico && legacy_mask_visible(frame, width)))
        {
            best_width = width;
            best = Some(single);
        }
    }
    best
}

#[cfg(windows)]
pub(super) fn read(path: &std::path::Path, index: i32) -> Option<Vec<u8>> {
    use crate::shortcut_icons::local_file;
    use std::{fs::File, io::Read};
    if !local_file(path) {
        return None;
    }
    let path = path.canonicalize().ok()?;
    if !local_file(&path) {
        return None;
    }
    let ext = path.extension()?.to_str()?;
    if ext.eq_ignore_ascii_case("ico") && index == 0 {
        let mut bytes = Vec::new();
        File::open(path)
            .ok()?
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        if bytes.len() > MAX_BYTES {
            return None;
        }
        from_ico(&bytes)
    } else if ext.eq_ignore_ascii_case("exe") || ext.eq_ignore_ascii_case("dll") {
        resources::Module::open(&path)?.icon(index)
    } else {
        None
    }
}

#[cfg(windows)]
mod resources {
    use std::{os::windows::ffi::OsStrExt, path::Path, ptr};
    use windows_sys::Win32::{
        Foundation::{FreeLibrary, HMODULE, HRSRC},
        System::LibraryLoader::{
            EnumResourceNamesExW, FindResourceW, LOAD_LIBRARY_AS_DATAFILE_EXCLUSIVE,
            LoadLibraryExW, LoadResource, LockResource, RESOURCE_ENUM_LN, SizeofResource,
        },
        UI::WindowsAndMessaging::{RT_GROUP_ICON, RT_ICON},
    };
    pub(super) struct Module(HMODULE);
    impl Module {
        pub(super) fn open(path: &Path) -> Option<Self> {
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            let module = unsafe {
                LoadLibraryExW(
                    wide.as_ptr(),
                    ptr::null_mut(),
                    LOAD_LIBRARY_AS_DATAFILE_EXCLUSIVE,
                )
            };
            if module.is_null() {
                None
            } else {
                Some(Self(module))
            }
        }
        fn bytes(&self, resource: HRSRC) -> Option<&[u8]> {
            if resource.is_null() {
                return None;
            }
            unsafe {
                let size = SizeofResource(self.0, resource) as usize;
                if size == 0 || size > super::MAX_BYTES {
                    return None;
                }
                let ptr = LockResource(LoadResource(self.0, resource));
                // The resource bytes stay mapped until this Module is dropped.
                (!ptr.is_null()).then(|| std::slice::from_raw_parts(ptr.cast(), size))
            }
        }
        pub(super) fn icon(&self, index: i32) -> Option<Vec<u8>> {
            let group = if index < 0 {
                let id = u16::try_from(index.unsigned_abs()).ok()?;
                unsafe { FindResourceW(self.0, id as _, RT_GROUP_ICON) }
            } else {
                let mut query = GroupAt {
                    remaining: index,
                    found: ptr::null_mut(),
                };
                unsafe {
                    EnumResourceNamesExW(
                        self.0,
                        RT_GROUP_ICON,
                        Some(find_group),
                        (&mut query as *mut GroupAt) as isize,
                        RESOURCE_ENUM_LN,
                        0,
                    );
                }
                query.found
            };
            super::best_frame(self.bytes(group)?, 14, |entry| {
                let id = u16::from_le_bytes(entry[12..14].try_into().ok()?);
                self.bytes(unsafe { FindResourceW(self.0, id as _, RT_ICON) })
            })
        }
    }
    impl Drop for Module {
        fn drop(&mut self) {
            unsafe {
                FreeLibrary(self.0);
            }
        }
    }
    struct GroupAt {
        remaining: i32,
        found: HRSRC,
    }
    unsafe extern "system" fn find_group(
        module: HMODULE,
        kind: *const u16,
        name: *const u16,
        arg: isize,
    ) -> i32 {
        // EnumResourceNamesExW calls this synchronously; string resource names expire after the callback.
        let query = unsafe { &mut *(arg as *mut GroupAt) };
        if query.remaining == 0 {
            query.found = unsafe { FindResourceW(module, name, kind) };
            return 0;
        }
        query.remaining -= 1;
        1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const POLAR: &[u8] = include_bytes!("../icons/icon.ico");

    fn original_frame(index: usize) -> (&'static [u8], &'static [u8]) {
        let pos = 6 + 16 * index;
        let header = &POLAR[pos..pos + 16];
        let start = u32::from_le_bytes(header[12..16].try_into().unwrap()) as usize;
        let size = u32::from_le_bytes(header[8..12].try_into().unwrap()) as usize;
        (header, &POLAR[start..start + size])
    }

    fn assert_frame(single: &[u8], index: usize) {
        let (header, frame) = original_frame(index);
        assert_eq!(single[..6], [0, 0, 1, 0, 1, 0]);
        assert_eq!(single[6..18], header[..12]);
        assert_eq!(single[18..22], 22u32.to_le_bytes());
        assert_eq!(&single[22..], frame);
    }

    #[test]
    fn picks_largest_intact_frame_without_scaling_or_changing_transparency() {
        assert_frame(&from_ico(POLAR).unwrap(), 5);
        let mut broken = POLAR.to_vec();
        let largest = original_frame(5).1;
        let end = broken.len();
        broken[end - largest.len()..].fill(0);
        assert_frame(&from_ico(&broken).unwrap(), 4);
        assert!(from_ico(&broken[..32]).is_none());
    }

    #[test]
    fn preserves_old_bitmap_icon_with_an_and_mask_and_no_alpha_bits() {
        let mut bitmap = vec![0u8; 48];
        bitmap[..4].copy_from_slice(&40u32.to_le_bytes());
        bitmap[4..8].copy_from_slice(&1u32.to_le_bytes());
        bitmap[8..12].copy_from_slice(&2u32.to_le_bytes());
        bitmap[12..14].copy_from_slice(&1u16.to_le_bytes());
        bitmap[14..16].copy_from_slice(&32u16.to_le_bytes());
        bitmap[40..44].copy_from_slice(&[0, 0, 255, 0]);
        let mut ico = vec![0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0];
        ico.extend_from_slice(&48u32.to_le_bytes());
        ico.extend_from_slice(&22u32.to_le_bytes());
        ico.extend_from_slice(&bitmap);
        assert_eq!(from_ico(&ico).as_deref(), Some(ico.as_slice()));
        ico[22 + 44] = 0x80;
        assert!(
            from_ico(&ico).is_none(),
            "fully masked image has no visible pixels"
        );
    }

    #[cfg(windows)]
    #[test]
    fn extracts_exact_group_by_ordinal_or_resource_id_from_a_local_exe() {
        use std::{fs, os::windows::ffi::OsStrExt};
        use windows_sys::Win32::{
            System::LibraryLoader::{BeginUpdateResourceW, EndUpdateResourceW, UpdateResourceW},
            UI::WindowsAndMessaging::{RT_GROUP_ICON, RT_ICON},
        };
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("로컬 게임.exe");
        fs::copy(std::env::current_exe().unwrap(), &file).unwrap();
        let name: Vec<u16> = file.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            let edit = BeginUpdateResourceW(name.as_ptr(), 1);
            assert!(!edit.is_null());
            for (id, frame) in [(10u16, 0), (20, 5)] {
                let (header, pixels) = original_frame(frame);
                let group = [&[0, 0, 1, 0, 1, 0][..], &header[..12], &id.to_le_bytes()].concat();
                for (kind, bytes) in [(RT_ICON, pixels), (RT_GROUP_ICON, group.as_slice())] {
                    assert_ne!(
                        UpdateResourceW(
                            edit,
                            kind,
                            id as _,
                            0,
                            bytes.as_ptr().cast(),
                            bytes.len() as u32
                        ),
                        0
                    );
                }
            }
            assert_ne!(EndUpdateResourceW(edit, 0), 0);
        }
        assert_frame(&read(&file, 0).unwrap(), 0);
        assert_frame(&read(&file, 1).unwrap(), 5);
        assert_frame(&read(&file, -20).unwrap(), 5);
        assert!(read(&file, -15).is_none());
        assert!(read(&file, 2).is_none());
        let ico = dir.path().join("game.ico");
        fs::write(&ico, POLAR).unwrap();
        assert_frame(&read(&ico, 0).unwrap(), 5);
    }
}
