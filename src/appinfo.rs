//! Read installed apps' classification and shortcut icon identifier from the local Steam binary cache.
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{BufReader, Cursor, Read, Seek, SeekFrom},
    path::Path,
};
type Types = HashMap<u32, bool>;

pub(crate) struct App {
    pub is_game: bool,
    pub client_icon: Option<String>,
}
type Apps = HashMap<u32, App>;
fn n32(s: &mut &[u8]) -> Option<u32> {
    Some(u32::from_le_bytes(s.split_off(..4)?.try_into().ok()?))
}
fn string<'a>(s: &mut &'a [u8]) -> Option<&'a [u8]> {
    let n = s.iter().position(|&b| b == 0)?;
    let v = s.split_off(..n)?;
    *s = &s[1..];
    Some(v)
}
fn keys(mut data: &[u8], count: u32) -> Option<Vec<&[u8]>> {
    if count > 100_000 {
        return None;
    }
    (0..count).map(|_| string(&mut data)).collect()
}
fn common_value<'a>(
    mut data: &'a [u8],
    table: Option<&[&[u8]]>,
    wanted: &[u8],
) -> Option<&'a [u8]> {
    let mut stack = Vec::new();
    while !data.is_empty() {
        let (&ty, rest) = data.split_first()?;
        data = rest;
        if ty == 8 {
            stack.pop()?;
            continue;
        }
        let key = if let Some(keys) = table {
            *keys.get(n32(&mut data)? as usize)?
        } else {
            string(&mut data)?
        };
        match ty {
            0 => {
                if stack.len() > 64 {
                    return None;
                }
                stack.push(key)
            }
            1 => {
                let value = string(&mut data)?;
                if key == wanted && stack.as_slice() == [b"appinfo".as_slice(), b"common"] {
                    return Some(value);
                }
            }
            2..=4 | 6 => data = data.get(4..)?,
            7 | 10 => data = data.get(8..)?,
            _ => return None,
        }
    }
    None
}
fn block<R: Read + Seek>(r: &mut R, offset: u64, size: usize) -> Option<Vec<u8>> {
    r.seek(SeekFrom::Start(offset)).ok()?;
    let mut bytes = vec![0; size];
    r.read_exact(&mut bytes).ok()?;
    Some(bytes)
}
fn read_apps<R: Read + Seek>(r: &mut R, ids: &HashSet<u32>) -> Option<Apps> {
    let len = r.seek(SeekFrom::End(0)).ok()?;
    let head = block(r, 0, 16)?;
    let magic = n32(&mut head.as_slice())?;
    let mut out = Apps::new();
    let mut record = |r: &mut R, id: u32, offset: u64, size: u64, keys: Option<&[&[u8]]>| {
        if ids.contains(&id)
            && let Some(bytes) = block(r, offset, size.min(128 * 1024) as usize)
            && let Some(kind) = common_value(&bytes, keys, b"type")
        {
            let is_game = [b"game".as_slice(), b"demo", b"mod", b"beta", b"playtest"]
                .iter()
                .any(|s| kind.eq_ignore_ascii_case(s));
            let client_icon = common_value(&bytes, keys, b"clienticon")
                .filter(|v| v.len() == 40 && v.iter().all(u8::is_ascii_hexdigit))
                .and_then(|v| std::str::from_utf8(v).ok())
                .map(str::to_owned);
            out.insert(
                id,
                App {
                    is_game,
                    client_icon,
                },
            );
        }
    };
    match magic {
        0x07564428 | 0x07564429 => {
            let indexed = magic == 0x07564429;
            let end = if indexed {
                u64::from_le_bytes(head[8..16].try_into().ok()?)
            } else {
                len
            };
            let table = if indexed {
                let size = len.checked_sub(end)?;
                if size > 8 * 1024 * 1024 {
                    return None;
                }
                block(r, end, size as usize)?
            } else {
                vec![]
            };
            let strings = if indexed {
                let mut bytes = table.as_slice();
                let n = n32(&mut bytes)?;
                Some(keys(bytes, n)?)
            } else {
                None
            };
            let mut at = if indexed { 16 } else { 8 };
            while at + 4 <= end {
                let id = n32(&mut block(r, at, 4)?.as_slice())?;
                if id == 0 {
                    return Some(out);
                }
                let size = n32(&mut block(r, at + 4, 4)?.as_slice())? as u64;
                if size < 60 || at + 8 + size > end {
                    return None;
                }
                record(r, id, at + 68, size - 60, strings.as_deref());
                at += 8 + size;
            }
            (at == end && indexed).then_some(out)
        }
        0x0756442a => {
            let header = block(r, 0, 44)?;
            let mut fields = &header[16..32];
            let count = n32(&mut fields)?;
            let idx = n32(&mut fields)? as usize;
            let nkeys = n32(&mut fields)?;
            let nbytes = n32(&mut fields)? as usize;
            if idx > 32 * 1024 * 1024 || nbytes > 8 * 1024 * 1024 || count as usize > idx / 16 {
                return None;
            }
            let index = block(r, 44, idx)?;
            let table = block(r, 44 + idx as u64, nbytes)?;
            let strings = keys(&table, nkeys)?;
            let start = 44 + (idx + nbytes) as u64;
            let mut entries = index.as_slice();
            for _ in 0..count {
                let id = n32(&mut entries)?;
                let off = n32(&mut entries)? as u64;
                let size = n32(&mut entries)? as u64;
                let extra = n32(&mut entries)? as usize;
                entries = entries.get(extra..)?;
                if size < 20 || start + off + size > len {
                    return None;
                }
                record(r, id, start + off + 20, size - 20, Some(&strings));
            }
            Some(out)
        }
        _ => None,
    }
}
fn types(apps: Apps) -> Types {
    apps.into_iter()
        .map(|(id, info)| (id, info.is_game))
        .collect()
}

pub fn categories(bytes: &[u8], ids: &HashSet<u32>) -> Option<Types> {
    read_apps(&mut Cursor::new(bytes), ids).map(types)
}
pub fn installed(cache: &Path, ids: &HashSet<u32>) -> Types {
    types(installed_apps(cache, ids))
}

pub(crate) fn installed_apps(cache: &Path, ids: &HashSet<u32>) -> Apps {
    let mut types = Apps::new();
    if ids.is_empty() {
        return types;
    }
    let mut paths = vec![cache.join("appinfo.vdf")];
    if let Ok(entries) = fs::read_dir(cache.join("appinfo")) {
        paths.extend(entries.flatten().map(|e| e.path()).filter(|p| {
            p.file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.starts_with("appinfo_") && s.ends_with(".vdf"))
        }));
    }
    for p in paths {
        if let Ok(file) = File::open(p)
            && let Some(found) = read_apps(&mut BufReader::new(file), ids)
        {
            types.extend(found)
        }
    }
    types
}
