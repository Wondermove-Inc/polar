# /// script
# dependencies = ["resvg-py==0.5.0", "Pillow==13.0.0"]
# ///
"""Regenerate the native application icons from Polar's home screen mark."""
from io import BytesIO
from pathlib import Path

from PIL import Image
from resvg_py import svg_to_bytes

desktop = Path(__file__).resolve().parents[1] / "desktop"
png = svg_to_bytes(svg_path=str(desktop / "ui/polar.svg"), width=1024, height=1024)
with Image.open(BytesIO(png)) as image:
    image.save(desktop / "icons/icon.ico", sizes=[(n, n) for n in (16, 32, 48, 64, 128, 256)])
    image.resize((512, 512), Image.Resampling.LANCZOS).save(desktop / "icons/icon.png")
    image.save(desktop / "icons/icon.icns")
