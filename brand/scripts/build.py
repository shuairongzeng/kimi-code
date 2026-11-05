"""Zimi Code brand asset builder — single source of truth.

Regenerate everything:  python brand/scripts/build.py

Pure stdlib. The brand is ONE 10x4 pixel bitmap ("pixel Z") rendered two ways:
GUI (SVG/PNG, this file) and CLI (Unicode quadrant-block text, brand/ascii.txt).
Outputs:
  brand/*.svg           master vectors (icon, mono, favicon derivations,
                        wordmark dark/light, lockup dark/light, animated, social)
  brand/ascii.txt         2-row TUI logo (same bitmap, quadrant-encoded)
  brand/exports/*.png     rasterized icons (16-1024), favicon.ico, social card
"""

import json
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPORTS = ROOT / "exports"

# ---------------------------------------------------------------------------
# Source data
# ---------------------------------------------------------------------------

# 10 cols x 4 rows. 0 = empty, 1 = base pixel, 2 = accent pixel (the cursor
# resting at the end of the output — bottom-right of the Z).
GRID = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 1, 1, 1, 0, 0],
    [0, 0, 1, 1, 1, 0, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
]

TILE = "#0C1210"   # green-black terminal screen
BASE = "#7EE787"   # P1 phosphor green
ACCENT = "#FFBF47"  # VT220 amber
INK = "#144024"    # deep green for light surfaces
INK_ACCENT = "#D97706"  # amber readable on white
DIM = "#3E7A54"    # dimmed phosphor for taglines

QUADRANT = {
    0: " ", 1: "▘", 2: "▝", 3: "▀", 4: "▖", 5: "▌", 6: "▞", 7: "▛",
    8: "▗", 9: "▚", 10: "▐", 11: "▜", 12: "▄", 13: "▙", 14: "▟", 15: "█",
}

# 5x7 pixel font (rows top to bottom, '1' = filled).
FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    " ": ["00000"] * 7,
    "·": ["00000", "00000", "00000", "00100", "00000", "00000", "00000"],
}

WORDMARK_TEXT = "ZIMI CODE"
TAGLINE = "AI CODING AGENT · BORN IN THE TERMINAL"


def text_cells(text: str) -> list[tuple[int, int]]:
    """Filled (col, row) cells for pixel-font text, 1 col tracking per glyph."""
    cells = []
    x = 0
    for ch in text:
        glyph = FONT[ch]
        for r, row in enumerate(glyph):
            for c, bit in enumerate(row):
                if bit == "1":
                    cells.append((x + c, r))
        x += 6
    return cells


def wordmark_width(text: str) -> int:
    return len(text) * 6 - 1


# ---------------------------------------------------------------------------
# SVG writers
# ---------------------------------------------------------------------------

def hex_rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def paths_from_cells(cells, px: float, ox: float, oy: float, colors) -> str:
    by_color: dict[str, list[str]] = {}
    for c, r, color_key in cells:
        x = ox + c * px
        y = oy + r * px
        by_color.setdefault(colors[color_key], []).append(
            f"M{x:g} {y:g}h{px:g}v{px:g}h-{px:g}z"
        )
    return "\n    ".join(
        f'<path fill="{color}" d="{" ".join(ds)}"/>' for color, ds in by_color.items()
    )


def grid_cells(grid) -> list[tuple[int, int, int]]:
    return [(c, r, v) for r, row in enumerate(grid) for c, v in enumerate(row) if v]


def svg_doc(body: str, w: float, h: float) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}">\n'
        f"  {body}\n</svg>\n"
    )


def icon_svg(mono: bool = False) -> str:
    cells = grid_cells(GRID)
    px, ox, oy = 6, 2, 20
    if mono:
        body = paths_from_cells(cells, px, ox, oy, {1: "currentColor", 2: "currentColor"})
        return svg_doc(f'<g shape-rendering="crispEdges">\n    {body}\n  </g>', 64, 64)
    colors = {1: BASE, 2: ACCENT}
    tile = f'<rect width="64" height="64" rx="12" fill="{TILE}"/>'
    pixels = paths_from_cells(cells, px, ox, oy, colors)
    return svg_doc(f'{tile}\n  <g shape-rendering="crispEdges">\n    {pixels}\n  </g>', 64, 64)


def favicon_svg(size: int) -> str:
    px = 1 if size == 16 else 3
    grid_w = len(GRID[0]) * px
    grid_h = len(GRID) * px
    ox = (size - grid_w) // 2
    oy = (size - grid_h) // 2
    rx = 3 if size == 16 else 9
    tile = f'<rect width="{size}" height="{size}" rx="{rx}" fill="{TILE}"/>'
    pixels = paths_from_cells(grid_cells(GRID), px, ox, oy, {1: BASE, 2: ACCENT})
    return svg_doc(f'{tile}\n  <g shape-rendering="crispEdges">\n    {pixels}\n  </g>', size, size)


def wordmark_body(text_color: str, cursor_color: str, px: int, ox: int, oy: int) -> str:
    cells = [(c, r, 1) for c, r in text_cells(WORDMARK_TEXT)]
    cursor_x = wordmark_width(WORDMARK_TEXT) + 1
    cells += [(cursor_x + c, r, 2) for r in range(7) for c in range(5)]
    return paths_from_cells(cells, px, ox, oy, {1: text_color, 2: cursor_color})


def wordmark_svg(dark: bool) -> str:
    text_color, cursor = (BASE, ACCENT) if dark else (INK, INK_ACCENT)
    w, h = wordmark_width(WORDMARK_TEXT) + 6, 7
    body = wordmark_body(text_color, cursor, 1, 0, 0)
    return svg_doc(f'<g shape-rendering="crispEdges">\n    {body}\n  </g>', w, h)


def lockup_svg(dark: bool) -> str:
    text_color, cursor = (BASE, ACCENT) if dark else (INK, INK_ACCENT)
    tile = f'<rect width="64" height="64" rx="12" fill="{TILE}"/>'
    icon_px = paths_from_cells(grid_cells(GRID), 6, 2, 20, {1: BASE, 2: ACCENT})
    wpx = 6
    wm_w = (wordmark_width(WORDMARK_TEXT) + 6) * wpx
    wm = wordmark_body(text_color, cursor, wpx, 64 + 24, (64 - 7 * wpx) // 2)
    w = 64 + 24 + wm_w
    return svg_doc(
        f'{tile}\n  <g shape-rendering="crispEdges">\n    {icon_px}\n  </g>\n'
        f'  <g shape-rendering="crispEdges">\n    {wm}\n  </g>',
        w,
        64,
    )


def animated_svg() -> str:
    tile = f'<rect width="64" height="64" rx="12" fill="{TILE}"/>'
    rects = []
    cells = sorted(grid_cells(GRID), key=lambda c: (c[1], c[0]))
    step = 0.045
    for i, (c, r, v) in enumerate(cells):
        color = ACCENT if v == 2 else BASE
        x, y = 2 + c * 6, 20 + r * 6
        begin = f"{i * step:.2f}s"
        rects.append(
            f'<rect x="{x}" y="{y}" width="6" height="6" fill="{color}" opacity="0">'
            f'<animate attributeName="opacity" from="0" to="1" begin="{begin}" '
            f'dur="0.001s" fill="freeze"/></rect>'
        )
    total = len(cells) * step
    blink = (
        f'<rect x="56" y="38" width="6" height="6" fill="{ACCENT}" opacity="0">'
        f'<animate attributeName="opacity" values="0;1;0.15;1" keyTimes="0;0.1;0.5;1" '
        f'begin="{total:.2f}s" dur="1.2s" repeatCount="indefinite"/></rect>'
    )
    body = tile + "\n  " + "\n  ".join(rects[:-1]) + "\n  " + blink
    return svg_doc(body, 64, 64)


def social_svg() -> str:
    bg = f'<rect width="1280" height="640" fill="{TILE}"/>'
    icon_px, icon_w, icon_h = 22, 220, 88
    icon = paths_from_cells(
        grid_cells(GRID), icon_px, (1280 - icon_w) // 2, 195, {1: BASE, 2: ACCENT}
    )
    wm_px = 8
    wm_w = (wordmark_width(WORDMARK_TEXT) + 6) * wm_px
    wm = wordmark_body(BASE, ACCENT, wm_px, (1280 - wm_w) // 2, 323)
    tag_px = 2
    tag_w = wordmark_width(TAGLINE) * tag_px
    tag = paths_from_cells(
        [(c, r, 1) for c, r in text_cells(TAGLINE)],
        tag_px,
        (1280 - tag_w) // 2,
        423,
        {1: DIM},
    )
    return svg_doc(
        f'{bg}\n  <g shape-rendering="crispEdges">\n    {icon}\n  </g>\n'
        f'  <g shape-rendering="crispEdges">\n    {wm}\n  </g>\n'
        f'  <g shape-rendering="crispEdges">\n    {tag}\n  </g>',
        1280,
        640,
    )


def ascii_logo() -> str:
    lines = []
    for tr in range(len(GRID) // 2):
        line = ""
        for tc in range(len(GRID[0]) // 2):
            bits = 0
            for dr, dc, bit in ((0, 0, 1), (0, 1, 2), (1, 0, 4), (1, 1, 8)):
                if GRID[tr * 2 + dr][tc * 2 + dc]:
                    bits |= bit
            line += QUADRANT[bits]
        lines.append(line.rstrip())
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Rasterizer (pure stdlib, RGBA, src-over)
# ---------------------------------------------------------------------------

def parse_color(h: str) -> tuple[int, int, int, int]:
    r, g, b = hex_rgb(h)
    return r, g, b, 255


class Canvas:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.buf = bytearray(w * h * 4)

    def blend(self, x: int, y: int, color, alpha: float) -> None:
        if not (0 <= x < self.w and 0 <= y < self.h) or alpha <= 0:
            return
        i = (y * self.w + x) * 4
        sr, sg, sb, sa = color
        a = sa / 255 * alpha
        inv = 1 - a
        self.buf[i] = round(sr * a + self.buf[i] * inv)
        self.buf[i + 1] = round(sg * a + self.buf[i + 1] * inv)
        self.buf[i + 2] = round(sb * a + self.buf[i + 2] * inv)
        self.buf[i + 3] = round(255 * a + self.buf[i + 3] * inv)

    def fill_rect(self, x: float, y: float, w: float, h: float, color) -> None:
        x0, y0 = round(x), round(y)
        for j in range(y0, round(y + h)):
            for i in range(x0, round(x + w)):
                self.blend(i, j, color, 1.0)

    @staticmethod
    def _in_rounded(px: float, py: float, x: float, y: float, w: float, h: float, r: float) -> bool:
        qx = min(max(px, x + r), x + w - r)
        qy = min(max(py, y + r), y + h - r)
        return (px - qx) ** 2 + (py - qy) ** 2 <= r * r

    def fill_rounded_rect(self, x, y, w, h, r, color) -> None:
        for j in range(int(y), int(y + h + 1)):
            for i in range(int(x), int(x + w + 1)):
                corners = (
                    self._in_rounded(i, j, x, y, w, h, r),
                    self._in_rounded(i + 1, j, x, y, w, h, r),
                    self._in_rounded(i, j + 1, x, y, w, h, r),
                    self._in_rounded(i + 1, j + 1, x, y, w, h, r),
                )
                if all(corners):
                    self.blend(i, j, color, 1.0)
                elif any(corners):
                    hits = sum(
                        self._in_rounded(i + (k % 4 + 0.5) / 4, j + (k // 4 + 0.5) / 4, x, y, w, h, r)
                        for k in range(16)
                    )
                    if hits:
                        self.blend(i, j, color, hits / 16)

    def write_png(self, path: Path) -> None:
        raw = b"".join(
            b"\x00" + bytes(self.buf[y * self.w * 4 : (y + 1) * self.w * 4])
            for y in range(self.h)
        )
        def chunk(tag: bytes, data: bytes) -> bytes:
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )
        png = (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b"")
        )
        path.write_bytes(png)


def render_icon_png(size: int, bespoke: bool) -> bytes:
    c = Canvas(size, size)
    if bespoke:
        px = 1 if size == 16 else 3
        rx = 3 if size == 16 else 9
        ox = (size - len(GRID[0]) * px) // 2
        oy = (size - len(GRID) * px) // 2
        c.fill_rounded_rect(0, 0, size, size, rx, parse_color(TILE))
    else:
        s = size / 64
        px, ox, oy = 6 * s, 2 * s, 20 * s
        c.fill_rounded_rect(0, 0, size, size, 12 * s, parse_color(TILE))
    base, accent = parse_color(BASE), parse_color(ACCENT)
    for col, row, v in grid_cells(GRID):
        c.fill_rect(ox + col * px, oy + row * px, px, px, accent if v == 2 else base)
    tmp = EXPORTS / "_tmp.png"
    c.write_png(tmp)
    data = tmp.read_bytes()
    tmp.unlink()
    return data


def render_social_png(path: Path) -> None:
    c = Canvas(1280, 640)
    c.fill_rect(0, 0, 1280, 640, parse_color(TILE))
    base, accent, dim = parse_color(BASE), parse_color(ACCENT), parse_color(DIM)
    for col, row, v in grid_cells(GRID):
        c.fill_rect(530 + col * 22, 195 + row * 22, 22, 22, accent if v == 2 else base)
    wm_px = 8
    wm_w = (wordmark_width(WORDMARK_TEXT) + 6) * wm_px
    ox = (1280 - wm_w) // 2
    for col, row in text_cells(WORDMARK_TEXT):
        c.fill_rect(ox + col * wm_px, 323 + row * wm_px, wm_px, wm_px, base)
    cx = ox + (wordmark_width(WORDMARK_TEXT) + 1) * wm_px
    c.fill_rect(cx, 323, 5 * wm_px, 7 * wm_px, accent)
    tag_px = 2
    tag_w = wordmark_width(TAGLINE) * tag_px
    tox = (1280 - tag_w) // 2
    for col, row in text_cells(TAGLINE):
        c.fill_rect(tox + col * tag_px, 423 + row * tag_px, tag_px, tag_px, dim)
    c.write_png(path)


# ---------------------------------------------------------------------------
# ICO
# ---------------------------------------------------------------------------

def build_ico(pngs: list[bytes]) -> bytes:
    entries = []
    offset = 6 + 16 * len(pngs)
    for data in pngs:
        w, h = struct.unpack(">II", data[16:24])
        entries.append(
            struct.pack("<BBBBHHII", 0 if w >= 256 else w, 0 if h >= 256 else h,
                        0, 0, 1, 32, len(data), offset)
        )
        offset += len(data)
    return struct.pack("<HHH", 0, 1, len(pngs)) + b"".join(entries) + b"".join(pngs)


def verify_ico(path: Path, expected: list[tuple[int, int]]) -> None:
    data = path.read_bytes()
    reserved, itype, count = struct.unpack("<HHH", data[:6])
    assert reserved == 0 and itype == 1 and count == len(expected)
    for i, (ew, eh) in enumerate(expected):
        w, h, _c, _r, _p, _b, size, off = struct.unpack(
            "<BBBBHHII", data[6 + 16 * i : 22 + 16 * i]
        )
        assert (256 if w == 0 else w, 256 if h == 0 else h) == (ew, eh)
        assert data[off : off + 8] == b"\x89PNG\r\n\x1a\n"
        assert off + size <= len(data)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    EXPORTS.mkdir(parents=True, exist_ok=True)
    svgs = {
        "icon.svg": icon_svg(),
        "icon-mono.svg": icon_svg(mono=True),
        "favicon-16.svg": favicon_svg(16),
        "favicon-48.svg": favicon_svg(48),
        "wordmark-dark.svg": wordmark_svg(dark=True),
        "wordmark-light.svg": wordmark_svg(dark=False),
        "lockup-dark.svg": lockup_svg(dark=True),
        "lockup-light.svg": lockup_svg(dark=False),
        "animated.svg": animated_svg(),
        "social-preview.svg": social_svg(),
    }
    for name, content in svgs.items():
        (ROOT / name).write_text(content, encoding="utf-8")
    (ROOT / "ascii.txt").write_text(ascii_logo(), encoding="utf-8")

    favicon16 = render_icon_png(16, bespoke=True)
    favicon48 = render_icon_png(48, bespoke=True)
    favicon32 = render_icon_png(32, bespoke=False)
    (EXPORTS / "icon-16.png").write_bytes(favicon16)
    (EXPORTS / "icon-32.png").write_bytes(favicon32)
    (EXPORTS / "icon-48.png").write_bytes(favicon48)
    for size in (128, 256, 512, 1024):
        (EXPORTS / f"icon-{size}.png").write_bytes(render_icon_png(size, bespoke=False))
    (EXPORTS / "favicon.ico").write_bytes(build_ico([favicon16, favicon32, favicon48]))
    render_social_png(EXPORTS / "social-preview.png")

    import xml.dom.minidom

    for name in svgs:
        xml.dom.minidom.parse(str(ROOT / name))
    verify_ico(EXPORTS / "favicon.ico", [(16, 16), (32, 32), (48, 48)])
    for png in sorted(EXPORTS.glob("*.png")):
        data = png.read_bytes()
        assert data[:8] == b"\x89PNG\r\n\x1a\n", png
        w, h = struct.unpack(">II", data[16:24])
        print(f"  {png.name}: {w}x{h} {len(data)}B")
    rows = ascii_logo().splitlines()
    assert len(rows) == 2 and all(0 < len(r) <= 8 for r in rows)
    print(f"ascii: {rows}")
    print("build OK")


if __name__ == "__main__":
    main()
