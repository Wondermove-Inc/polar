# /// script
# dependencies = ["pefile==2024.8.26"]
# ///
"""Check the icon resources in the built app, setup, and extracted uninstaller."""
import argparse
import struct
from pathlib import Path

import pefile


def icon_frames(path):
    data = path.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data)
    assert (reserved, kind, count) == (0, 1, 6), path
    frames = {}
    for i in range(count):
        w, h, _, _, _, _, size, offset = struct.unpack_from("<BBBBHHII", data, 6 + 16 * i)
        frames[w or 256, h or 256] = data[offset:offset + size]
    assert set(frames) == {(s, s) for s in (16, 32, 48, 64, 128, 256)}, path
    return frames


def check_executable(path, group_id, expected):
    with pefile.PE(str(path), fast_load=True) as pe:
        pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_RESOURCE"]])
        resources = {}
        for kind in pe.DIRECTORY_ENTRY_RESOURCE.entries:
            if kind.id in (3, 14):  # RT_ICON and RT_GROUP_ICON
                for item in kind.directory.entries:
                    for language in item.directory.entries:
                        info = language.data.struct
                        resources[kind.id, item.id, language.id] = pe.get_data(info.OffsetToData, info.Size)
    groups = [(lang, data) for (kind, item, lang), data in resources.items() if (kind, item) == (14, group_id)]
    assert groups, f"{path}: missing icon group {group_id}"
    for lang, group in groups:
        reserved, kind, count = struct.unpack_from("<HHH", group)
        assert (reserved, kind, count) == (0, 1, len(expected)), f"{path}: unexpected icon group"
        actual = {}
        for w, h, _, _, _, _, size, icon_id in struct.iter_unpack("<BBBBHHIH", group[6:]):
            frame = resources[3, icon_id, lang]
            assert len(frame) == size, path
            actual[w or 256, h or 256] = frame
        assert actual == expected, f"{path}: embedded icon differs from Polar ICO"
    print(f"{path.name}: all six icon frames match")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "setup", "uninstaller"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    ico = Path(__file__).resolve().parents[1] / "desktop/icons/icon.ico"
    for path, group in ((args.app, 32512), (args.setup, 103), (args.uninstaller, 103)):
        check_executable(path, group, icon_frames(ico))
