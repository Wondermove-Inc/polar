//! Read icon frames without launching a shortcut or loading a game as executable code.
use image::{ImageFormat, ImageReader, Limits, RgbaImage};
use std::io::Cursor;

const MAX_BYTES: usize = 4 * 1024 * 1024;

fn from_ico(bytes: &[u8]) -> Option<RgbaImage> {
    best_frame(bytes, 16, |entry| {
        let start = u32::from_le_bytes(entry[12..16].try_into().ok()?) as usize;
        let len = u32::from_le_bytes(entry[8..12].try_into().ok()?) as usize;
        bytes.get(start..start.checked_add(len)?)
    })
}

// A 32-bit BI_RGB icon uses its own alpha plane unless every alpha byte is zero.
fn restore_bitmap_alpha(dib: &[u8], image: &mut RgbaImage) -> Option<()> {
    if dib.len() < 40 || dib[14..16] != 32u16.to_le_bytes() || dib[16..20] != [0; 4] {
        return None;
    }
    let header = u32::from_le_bytes(dib[..4].try_into().ok()?) as usize;
    let colors = u32::from_le_bytes(dib[32..36].try_into().ok()?) as usize;
    let start = header.checked_add(colors.checked_mul(4)?)?;
    let width = image.width() as usize;
    let end = start.checked_add(width * width * 4)?;
    let pixels = dib.get(start..end)?.as_chunks::<4>().0;
    let stride = width.div_ceil(32) * 4;
    let mask = if pixels.iter().all(|p| p[3] == 0) {
        Some(dib.get(end..)?.get(..stride * width)?)
    } else {
        None
    };
    let top_down = i32::from_le_bytes(dib[8..12].try_into().ok()?) < 0;
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let row = if top_down {
            y as usize
        } else {
            width - 1 - y as usize
        };
        let x = x as usize;
        pixel[3] = match mask {
            None => pixels[row * width + x][3],
            Some(mask) if mask[row * stride + x / 8] & (0x80 >> (x % 8)) == 0 => 255,
            Some(_) => 0,
        };
    }
    Some(())
}

fn visible_art(image: RgbaImage) -> Option<RgbaImage> {
    let (w, h) = image.dimensions();
    let (mut left, mut top, mut right, mut bottom) = (w, h, 0, 0);
    let mut count = 0;
    for (x, y, p) in image.enumerate_pixels() {
        if p[3] >= 24 {
            left = left.min(x);
            top = top.min(y);
            right = right.max(x);
            bottom = bottom.max(y);
            count += 1;
        }
    }
    if count < 12 {
        return None;
    }
    let width = right - left + 1;
    let height = bottom - top + 1;
    if width.min(height) < 4 || count < width * height / 256 {
        return None;
    }
    if (width, height) == (w, h) {
        // A flat opaque plate is empty. A single-color silhouette on transparency is useful art.
        let first = image.get_pixel(0, 0);
        if image
            .pixels()
            .all(|p| p.0.iter().zip(first.0).all(|(a, b)| a.abs_diff(b) < 4))
        {
            return None;
        }
        return Some(image);
    }
    Some(image::imageops::crop_imm(&image, left, top, width, height).to_image())
}

// ICO directories and Windows RT_GROUP_ICON share the first 12 bytes of each entry.
// The remainder is either a file offset (ICO) or an RT_ICON resource ID (PE).
fn best_frame<'a>(
    directory: &[u8],
    stride: usize,
    data: impl Fn(&[u8]) -> Option<&'a [u8]>,
) -> Option<RgbaImage> {
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
        if width != image.height() || (if width >= 256 { 0 } else { width as u8 }) != entry[0] {
            continue;
        }
        let mut image = image.into_rgba8();
        if format == ImageFormat::Ico {
            restore_bitmap_alpha(frame, &mut image);
        }
        if let Some(art) = visible_art(image) {
            let detail = art.width().min(art.height());
            if detail > best_width {
                best_width = detail;
                best = Some(art);
            }
        }
    }
    best
}

#[cfg(windows)]
pub(super) fn read(path: &std::path::Path, index: i32) -> Option<RgbaImage> {
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
        pub(super) fn icon(&self, index: i32) -> Option<super::RgbaImage> {
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

    fn assert_frame(image: &image::RgbaImage, index: usize) {
        let (_, frame) = original_frame(index);
        let expected = image::load_from_memory(frame).unwrap().into_rgba8();
        assert!(image.width().abs_diff(expected.width()) <= expected.width() / 16);
        assert_eq!(image.width(), image.height());
        assert_eq!(
            image.get_pixel(image.width() / 2, image.height() / 2),
            expected.get_pixel(expected.width() / 2, expected.height() / 2)
        );
    }

    #[test]
    fn picks_largest_intact_frame() {
        assert_frame(&from_ico(POLAR).unwrap(), 5);
        let mut broken = POLAR.to_vec();
        let largest = original_frame(5).1;
        let end = broken.len();
        broken[end - largest.len()..].fill(0);
        assert_frame(&from_ico(&broken).unwrap(), 4);
        assert!(from_ico(&broken[..32]).is_none());
    }

    fn ico(images: &[image::RgbaImage]) -> Vec<u8> {
        let mut result = vec![0, 0, 1, 0];
        result.extend_from_slice(&(images.len() as u16).to_le_bytes());
        let mut payload = Vec::new();
        for image in images {
            let mut png = Cursor::new(Vec::new());
            image.write_to(&mut png, ImageFormat::Png).unwrap();
            let width = if image.width() >= 256 {
                0
            } else {
                image.width() as u8
            };
            result.extend_from_slice(&[width, width, 0, 0, 1, 0, 32, 0]);
            result.extend_from_slice(&(png.get_ref().len() as u32).to_le_bytes());
            let offset = 6 + images.len() * 16 + payload.len();
            result.extend_from_slice(&(offset as u32).to_le_bytes());
            payload.extend_from_slice(png.get_ref());
        }
        result.extend(payload);
        result
    }

    #[test]
    fn ranks_visible_art_and_trims_nearly_invisible_padding() {
        use image::{Rgba, RgbaImage};
        let padded = RgbaImage::from_fn(256, 256, |x, y| {
            if (100..132).contains(&x) && (70..94).contains(&y) {
                Rgba([255, 255, 255, 255])
            } else {
                Rgba([0, 0, 0, 1])
            }
        });
        let compact = from_ico(&ico(std::slice::from_ref(&padded))).unwrap();
        assert_eq!(compact.dimensions(), (32, 24));
        let art = RgbaImage::from_fn(96, 96, |x, y| Rgba([x as u8, 90, y as u8, 255]));
        assert_eq!(from_ico(&ico(&[padded, art.clone()])).unwrap(), art);
        let big = RgbaImage::from_fn(512, 512, |x, y| Rgba([x as u8, y as u8, 10, 255]));
        assert_eq!(from_ico(&ico(&[art, big.clone()])).unwrap(), big);
    }

    #[test]
    fn empty_and_blank_frames_allow_a_cover_fallback() {
        use image::{Rgba, RgbaImage};
        let mut dust = RgbaImage::from_pixel(256, 256, Rgba([40, 90, 70, 2]));
        dust.put_pixel(80, 90, Rgba([255, 255, 255, 255]));
        let blank = RgbaImage::from_pixel(64, 64, Rgba([12, 13, 14, 255]));
        assert!(from_ico(&ico(&[dust, blank])).is_none());
    }

    #[test]
    fn reconstructs_bottom_up_legacy_mask_and_rejects_an_empty_mask() {
        let width = 16usize;
        let mask = 40 + width * width * 4;
        let mut bitmap = vec![0u8; mask + 4 * width];
        bitmap[..4].copy_from_slice(&40u32.to_le_bytes());
        bitmap[4..8].copy_from_slice(&(width as u32).to_le_bytes());
        bitmap[8..12].copy_from_slice(&(2 * width as u32).to_le_bytes());
        bitmap[12..14].copy_from_slice(&1u16.to_le_bytes());
        bitmap[14..16].copy_from_slice(&32u16.to_le_bytes());
        bitmap[mask..].fill(255);
        // Opaque red L with a wide foot in the bottom row of the displayed icon.
        for y in 0..width {
            for x in 2..if y < 6 { 14 } else { 7 } {
                bitmap[40 + (y * width + x) * 4 + 2] = 240;
                bitmap[mask + y * 4 + x / 8] &= !(0x80 >> (x % 8));
            }
        }
        let mut file = vec![0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0];
        file.extend_from_slice(&(bitmap.len() as u32).to_le_bytes());
        file.extend_from_slice(&22u32.to_le_bytes());
        file.extend_from_slice(&bitmap);
        let normalized = from_ico(&file).unwrap();
        assert_eq!(normalized.dimensions(), (12, 16));
        assert_eq!(normalized.get_pixel(11, 0)[3], 0);
        assert_eq!(normalized.get_pixel(11, 15).0, [240, 0, 0, 255]);
        file[22 + mask..].fill(255);
        assert!(from_ico(&file).is_none());

        // A true-alpha DIB can have mask bits set even where its artwork has soft edges.
        for y in 0..width {
            for x in 0..width {
                let alpha = 22 + 40 + (y * width + x) * 4 + 3;
                file[alpha] = if y == 0 { 64 } else { 255 };
            }
        }
        let alpha = from_ico(&file).unwrap();
        assert_eq!(alpha.dimensions(), (16, 16));
        assert_eq!(alpha.get_pixel(3, 0)[3], 255);
        assert_eq!(alpha.get_pixel(3, 15)[3], 64);
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
