"""Generate the Yawp app icon set.

Brand mark: an elegant serif 'Y' on paper white, with a small red "yawp" — three
sound-wave arcs bursting from the upper right, echoing the recording dot and the
barbaric yawp the app is named for. Drawn once at 1024 px and downsampled for
the sizes Tauri expects in src-tauri/icons/.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
ICONS_DIR = HERE.parent / "voice-app" / "src-tauri" / "icons"

# Brand palette (matches voice-app/src/styles/globals.css)
PAPER = (251, 251, 250)
PAPER_DEEP = (244, 243, 239)
INK = (25, 25, 25)
ACCENT = (200, 48, 46)
RULE = (216, 214, 207)

# Prefer a high-contrast display serif; fall back gracefully. We test-load each
# candidate (some installed .ttf files aren't actually loadable by PIL).
FONT_PATHS = [
    Path.home() / ".local/share/fonts/CormorantGaramond-Bold.ttf",
    Path.home() / ".local/share/fonts/CormorantGaramond-SemiBold.ttf",
    Path.home() / ".local/share/fonts/EBGaramond.ttf",
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"),
    Path("/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf"),
]


def _pick_font() -> Path:
    for p in FONT_PATHS:
        if not p.exists():
            continue
        try:
            ImageFont.truetype(str(p), size=64)
            return p
        except OSError:
            continue
    raise SystemExit("no usable serif font found")


FONT_PATH = _pick_font()


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    scale = 4
    mask_hi = Image.new("L", (size * scale, size * scale), 0)
    d = ImageDraw.Draw(mask_hi)
    d.rounded_rectangle(
        (0, 0, size * scale - 1, size * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return mask_hi.resize((size, size), Image.LANCZOS)


def _yawp_waves(draw: ImageDraw.ImageDraw, size: int) -> None:
    """A little burst springing into the upper-right corner — the yawp coming
    out. A source dot near the Y's right arm, with arcs radiating to the corner."""
    cx = int(size * 0.63)
    cy = int(size * 0.32)
    width = max(2, int(size * 0.026))
    # arcs hug the top-right quadrant so they expand into empty space, not the Y
    waves = [(0.105, 255), (0.165, 200), (0.225, 140)]
    for frac, alpha in waves:
        r = int(size * frac)
        draw.arc(
            (cx - r, cy - r, cx + r, cy + r),
            start=274,
            end=356,
            fill=(*ACCENT, alpha),
            width=width,
        )
    dot = max(3, int(size * 0.026))
    draw.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=ACCENT)


def draw_icon(size: int = 1024) -> Image.Image:
    img = Image.new("RGB", (size, size), PAPER)
    draw = ImageDraw.Draw(img, "RGBA")

    # Hairline inner rule — a printed-card edge.
    edge = max(1, int(size * 0.008))
    draw.rounded_rectangle(
        (edge, edge, size - edge - 1, size - edge - 1),
        radius=int(size * 0.22) - edge,
        outline=RULE,
        width=max(1, int(size * 0.004)),
    )

    # The Y — elegant serif, nudged down-left so the yawp can burst up-right.
    font_px = int(size * 0.66)
    font = ImageFont.truetype(str(FONT_PATH), size=font_px)
    text = "Y"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    cx_target = int(size * 0.50)
    cy_target = int(size * 0.56)
    x = cx_target - tw // 2 - bbox[0]
    y = cy_target - th // 2 - bbox[1]
    draw.text((x, y), text, fill=INK, font=font)

    # The yawp bursting from the upper-right.
    _yawp_waves(draw, size)

    mask = rounded_rect_mask(size, radius=int(size * 0.22))
    final = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    final.paste(img, (0, 0), mask)
    return final


def downsample(src: Image.Image, target: int) -> Image.Image:
    return src.resize((target, target), Image.LANCZOS)


def write_icon_set() -> None:
    src = draw_icon(1024)
    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    targets = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }
    for name, sz in targets.items():
        downsample(src, sz).save(ICONS_DIR / name, format="PNG", optimize=True)
        print(f"  wrote {name} ({sz}x{sz})")

    icns_path = ICONS_DIR / "icon.icns"
    try:
        downsample(src, 512).save(icns_path, format="ICNS")
        print("  wrote icon.icns")
    except Exception as e:
        print(f"  skipped icon.icns ({e})")

    ico_path = ICONS_DIR / "icon.ico"
    src.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("  wrote icon.ico")


if __name__ == "__main__":
    print(f"using font: {FONT_PATH}")
    write_icon_set()
