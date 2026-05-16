"""Generate the Voice app icon set.

Editorial Warm brand mark: a serif capital 'V' on warm paper, with a small
terracotta accent dot beneath. Designed once at 1024 px, downsampled for the
sizes Tauri expects in src-tauri/icons/.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
ICONS_DIR = HERE.parent / "voice-app" / "src-tauri" / "icons"

# Brand palette (must match globals.css)
PAPER = (247, 243, 234)
PAPER_DEEP = (240, 234, 219)
INK = (26, 22, 18)
ACCENT = (160, 56, 28)
RULE = (217, 207, 184)

# We use EB Garamond installed in the user's font dir. Falls back to DejaVu
# Serif Bold if missing.
FONT_PATHS = [
    Path.home() / ".local/share/fonts/EBGaramond.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"),
]
FONT_PATH = next((p for p in FONT_PATHS if p.exists()), None)
if FONT_PATH is None:
    raise SystemExit("no suitable serif font found")


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    """Generate an anti-aliased mask for a rounded square."""
    scale = 4
    mask_hi = Image.new("L", (size * scale, size * scale), 0)
    d = ImageDraw.Draw(mask_hi)
    d.rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return mask_hi.resize((size, size), Image.LANCZOS)


def draw_icon(size: int = 1024) -> Image.Image:
    img = Image.new("RGB", (size, size), PAPER)
    draw = ImageDraw.Draw(img, "RGBA")

    # Subtle inner edge — a hairline rule, like a printed card edge
    edge_inset = max(1, int(size * 0.008))
    draw.rounded_rectangle(
        (edge_inset, edge_inset, size - edge_inset - 1, size - edge_inset - 1),
        radius=int(size * 0.22) - edge_inset,
        outline=RULE,
        width=max(1, int(size * 0.004)),
    )

    # The Y — bold, refined serif at large optical size. The Y descender below
    # the baseline gives the mark a satisfying asymmetry.
    font_px = int(size * 0.78)
    font = ImageFont.truetype(str(FONT_PATH), size=font_px)
    text = "Y"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    # Position with optical centering — pull slightly up to leave room
    # for the accent below.
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1] - int(size * 0.045)
    draw.text((x, y), text, fill=INK, font=font)

    # Terracotta accent — a small "recording dot" sitting below the Y descender
    dot_r = int(size * 0.028)
    cx = size // 2
    cy = int(size * 0.88)
    draw.ellipse(
        (cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r),
        fill=ACCENT,
    )

    # Apply rounded mask
    mask = rounded_rect_mask(size, radius=int(size * 0.22))
    final = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    final.paste(img, (0, 0), mask)
    return final


def downsample(src: Image.Image, target: int) -> Image.Image:
    return src.resize((target, target), Image.LANCZOS)


def write_icon_set() -> None:
    src = draw_icon(1024)
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    # Tauri's required Linux/macOS PNG set
    targets = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }
    for name, sz in targets.items():
        downsample(src, sz).save(ICONS_DIR / name, format="PNG", optimize=True)
        print(f"  wrote {name} ({sz}×{sz})")

    # macOS .icns (Tauri references it). We bundle a single 512px frame.
    icns_path = ICONS_DIR / "icon.icns"
    try:
        downsample(src, 512).save(icns_path, format="ICNS")
        print(f"  wrote icon.icns")
    except Exception as e:
        print(f"  skipped icon.icns ({e})")

    # Windows .ico
    ico_path = ICONS_DIR / "icon.ico"
    src.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"  wrote icon.ico")


if __name__ == "__main__":
    print(f"using font: {FONT_PATH}")
    write_icon_set()
