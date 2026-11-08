"""Zimi Code brand asset builder — single source of truth.

Regenerate everything:  python brand/scripts/build.py

Pure stdlib. Concept A "Prism": a solid geometric Z (two bars + a 45-degree-
ish diagonal band) with a teal->green gradient on large standalone color
surfaces, and an amber square as the terminal cursor. The GUI renders the
vector masters; the TUI logo is a *documented approximation* (a hand-designed
10x4 grid, quadrant-block encoded) — it evokes the mark, it is not a second
renderer of a shared bitmap.
Outputs:
  brand/*.svg           master vectors (icon, mono, favicon derivations,
                        wordmark dark/light, lockup dark/light, animated, social)
  brand/ascii.txt         2-row TUI logo (quadrant-encoded approximation)
  brand/exports/*.png     rasterized icons (16-1024), favicon.ico, social card
  brand/exports/icon.ico  Electron multi-size icon (16-256, PNG-compressed)
  brand/exports/icon.icns Apple icon family (ic07-ic14, PNG payload)
  consumer sync           copies the generated assets to every in-repo consumer
                          (vscode, docs, dist-web, zimi-desktop build/)

Determinism: no timestamps, no randomness, exact rational arithmetic in the
rasterizer — two consecutive runs produce byte-identical files.
"""

import shutil
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
EXPORTS = ROOT / "exports"

# ---------------------------------------------------------------------------
# Source data — pinned to .tmp/concepts/concept-a-prism/final/ (owner sign-off).
# The mark geometry lives on a 64-unit integer grid: two horizontal bars plus
# a diagonal band, plus a 12x12 amber cursor square in the bottom-right.
# ---------------------------------------------------------------------------

# Z outline in user units (viewBox 0 0 64 64): bars + diagonal band.
MARK_POLY = [(8, 8), (56, 8), (56, 20), (20, 44), (40, 44), (40, 56), (8, 56), (8, 44), (44, 20), (8, 20)]
MARK_PATH = "M8 8h48v12L20 44h20v12H8V44l36-24H8Z"
# Same shape decomposed into three animated segments (top bar / diagonal band /
# bottom bar) for animated.svg.
MARK_SEGMENTS = [
    ("rect", (8, 8, 48, 12)),        # top bar
    ("poly", [(44, 20), (56, 20), (20, 44), (8, 44)]),  # diagonal band
    ("rect", (8, 44, 32, 12)),       # bottom bar
]
ACCENT_RECT = (44, 44, 12, 12)  # x, y, w, h — the amber cursor

# Bespoke small-size grid (16px canvas, 1px per unit). Run-compressed rows:
# full-width top bar, four 3px diagonal steps, bottom bar, 2x2 cursor with a
# 1px full-column gap (x=10) separating it from the bottom bar. This is an
# independent derivation — never a downscale of the master.
B16_RUNS = [(3, 4, 10, 2), (9, 6, 3, 1), (7, 7, 3, 1), (5, 8, 3, 1), (3, 9, 3, 1), (3, 10, 7, 2)]
B16_ACCENT = (11, 10, 2, 2)

# TUI approximation grid (10 cols x 4 rows, quadrant blocks; 2 = accent).
# Hand-designed to evoke the Prism Z: full-width top bar, two-step diagonal,
# bottom bar, separated cursor column. NOT a pixel-exact derivation.
GRID_TUI = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 0, 1, 1, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 0, 2, 2],
]

TILE = "#0C1210"        # green-black terminal screen (all export surfaces)
GRAD0 = "#2DD4BF"       # dark-surface gradient start (teal)
GRAD1 = "#7EE787"       # dark-surface gradient end (phosphor green)
ACCENT = "#FFBF47"      # VT220 amber cursor (dark surfaces)
INK_GRAD0 = "#0D9488"   # light-surface gradient start
INK_GRAD1 = "#16A34A"   # light-surface gradient start end
INK_ACCENT = "#D97706"  # amber readable on white
INK = "#144024"         # deep green wordmark on light surfaces
DIM = "#3E7A54"         # dimmed phosphor for taglines

# Gradient usage (surface-based predicate, mirrored in BRAND.md):
#   - Standalone color exports at >= STANDALONE_GRADIENT_MIN_PX carry the
#     userSpaceOnUse sRGB linear gradient.
#   - Embedded marks (lockup, social card) and the 64px app-icon surface use
#     the flat colors below: the gradient is a large-format treatment only.
#   - Bespoke 16/32/48 favicon derivations and all mono assets are flat by
#     design (a gradient adds nothing at pixel-grid sizes).
STANDALONE_GRADIENT_MIN_PX = 128
FLAT_DARK = GRAD1        # flat Z on dark surfaces (lockup, social, icon.svg)
FLAT_LIGHT = INK_GRAD0   # flat Z on light surfaces (lockup-light)
FLAT_LIGHT_16 = INK_GRAD1  # flat Z for the light 16px bespoke derivation

# Tile radius: 3/16 of the canvas on favicon tiles, 12/64 on the app icon.
FAVICON_TILE_RX_PER_PX = 3 / 16
ICON_TILE_RX = 12

QUADRANT = {
    0: " ", 1: "▘", 2: "▝", 3: "▀", 4: "▖", 5: "▌", 6: "▞", 7: "▛",
    8: "▗", 9: "▚", 10: "▐", 11: "▜", 12: "▄", 13: "▙", 14: "▟", 15: "█",
}

# 5x7 pixel font (rows top to bottom, '1' = filled). Row-major cell emission
# within each glyph matches the pinned lockup masters byte for byte.
FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "01110", "10000", "10000", "11111"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    " ": ["00000"] * 7,
    "·": ["00000", "00000", "00000", "00100", "00000", "00000", "00000"],
}

WORDMARK_TEXT = "ZIMI CODE"
TAGLINE = "AI CODING AGENT · BORN IN THE TERMINAL"

# Lockup metrics: icon 64 + gap 24 + wordmark (59 units x 6px) = 442 wide.
LOCKUP_GAP = 24
LOCKUP_WM_PX = 6
LOCKUP_WM_OX = 88          # 64 + 24
LOCKUP_WM_OY = 11          # (64 - 42) / 2


def text_cells(text: str) -> list[tuple[int, int]]:
    """Filled (col, row) cells for pixel-font text, 1 col tracking per glyph.

    Emission order: glyphs in text order, cells row-major within each glyph
    (this is the order the pinned lockup masters use).
    """
    cells = []
    for i, ch in enumerate(text):
        glyph = FONT[ch]
        for r in range(7):
            for c in range(5):
                if glyph[r][c] == "1":
                    cells.append((i * 6 + c, r))
    return cells


def wordmark_width(text: str) -> int:
    return len(text) * 6 - 1


def wordmark_total_width() -> int:
    """Text width + 1 gap + 5-wide cursor block."""
    return wordmark_width(WORDMARK_TEXT) + 6


# ---------------------------------------------------------------------------
# SVG writers
# ---------------------------------------------------------------------------

def hex_rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def emit_cells(cells, px: int, ox: int, oy: int) -> str:
    """One M..h..v..h..z rectangle per cell (pinned-master emission style)."""
    return " ".join(
        f"M{ox + c * px} {oy + r * px}h{px}v{px}h-{px}z" for c, r in cells
    )


def emit_runs(runs, k: int, edge_absolute: bool) -> str:
    """Run-compressed rects scaled by k.

    edge_absolute: first and last runs close with an absolute H command
    (the pinned favicon-32/48 style); interior runs close relative. The
    16px pinned masters use absolute H everywhere (k == 1 short-circuit).
    """
    parts = []
    n = len(runs)
    for idx, (x, y, w, h) in enumerate(runs):
        X, Y, W, H = x * k, y * k, w * k, h * k
        absolute = edge_absolute and (k == 1 or idx in (0, n - 1))
        close = f"H{X}z" if absolute else f"h-{W}z"
        parts.append(f"M{X} {Y}h{W}v{H}{close}")
    return " ".join(parts)


def emit_rect(r, k: int) -> str:
    x, y, w, h = r
    X, Y, W, H = x * k, y * k, w * k, h * k
    return f"M{X} {Y}h{W}v{H}h-{W}z"


def svg_doc(body: str, w, h) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:g} {h:g}">\n'
        f"  {body}\n</svg>\n"
    )


def mark_svg(dark: bool) -> str:
    """The pinned gradient master (byte-identical to final/mark-*.svg)."""
    gid, c0, c1, accent = (
        ("prism", GRAD0, GRAD1, ACCENT) if dark else ("prism-ink", INK_GRAD0, INK_GRAD1, INK_ACCENT)
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
        "  <defs>\n"
        f'    <linearGradient id="{gid}" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">\n'
        f'      <stop offset="0" stop-color="{c0}"/>\n'
        f'      <stop offset="1" stop-color="{c1}"/>\n'
        "    </linearGradient>\n"
        "  </defs>\n"
        f'  <path fill="url(#{gid})" d="{MARK_PATH}"/>\n'
        f'  <rect x="{ACCENT_RECT[0]}" y="{ACCENT_RECT[1]}" width="{ACCENT_RECT[2]}" height="{ACCENT_RECT[3]}" fill="{accent}"/>\n'
        "</svg>\n"
    )


def mono_svg() -> str:
    """Single currentColor paths, geometry identical to the color master."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
        f'  <path fill="currentColor" d="{MARK_PATH}"/>\n'
        f'  <rect x="{ACCENT_RECT[0]}" y="{ACCENT_RECT[1]}" width="{ACCENT_RECT[2]}" height="{ACCENT_RECT[3]}" fill="currentColor"/>\n'
        "</svg>\n"
    )


def mono16_svg() -> str:
    """Bespoke mono 16px: B16 grid, all cells currentColor, no tile."""
    runs = " ".join([emit_runs(B16_RUNS, 1, edge_absolute=True), emit_rect(B16_ACCENT, 1)])
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">\n'
        '  <g shape-rendering="crispEdges">\n'
        f'    <path fill="currentColor" d="{runs}"/>\n'
        "  </g>\n</svg>\n"
    )


def icon_svg() -> str:
    """App icon: tile + master geometry, flat dark colors (spec: 16-64px is
    the icon's main range, the gradient is a large-format treatment)."""
    return svg_doc(
        f'<rect width="64" height="64" rx="{ICON_TILE_RX}" fill="{TILE}"/>\n'
        f'  <path fill="{FLAT_DARK}" d="{MARK_PATH}"/>\n'
        f'  <rect x="{ACCENT_RECT[0]}" y="{ACCENT_RECT[1]}" width="{ACCENT_RECT[2]}" height="{ACCENT_RECT[3]}" fill="{ACCENT}"/>',
        64,
        64,
    )


def favicon_svg(size: int) -> str:
    """Bespoke favicon tile (16/32/48): B16 grid scaled by size/16."""
    k = size // 16
    rx = round(size * FAVICON_TILE_RX_PER_PX)
    return svg_doc(
        f'<rect width="{size}" height="{size}" rx="{rx}" fill="{TILE}"/>\n'
        '  <g shape-rendering="crispEdges">\n'
        f'    <path fill="{FLAT_DARK}" d="{emit_runs(B16_RUNS, k, edge_absolute=True)}"/>\n'
        f'    <path fill="{ACCENT}" d="{emit_rect(B16_ACCENT, k)}"/>\n'
        "  </g>",
        size,
        size,
    )


def wordmark_body(text_color: str, cursor_color: str, px: int, ox: int, oy: int) -> str:
    cells = text_cells(WORDMARK_TEXT)
    cursor_x = wordmark_width(WORDMARK_TEXT) + 1
    cursor_cells = [(cursor_x + c, r) for r in range(7) for c in range(5)]
    return (
        f'<path fill="{text_color}" d="{emit_cells(cells, px, ox, oy)}"/>\n'
        f'    <path fill="{cursor_color}" d="{emit_cells(cursor_cells, px, ox, oy)}"/>'
    )


def wordmark_svg(dark: bool) -> str:
    text_color, cursor = (FLAT_DARK, ACCENT) if dark else (INK, INK_ACCENT)
    w = wordmark_total_width()
    return svg_doc(
        f'<g shape-rendering="crispEdges">\n    {wordmark_body(text_color, cursor, 1, 0, 0)}\n  </g>',
        w,
        7,
    )


def lockup_svg(dark: bool) -> str:
    """Icon + wordmark. The dark variant leads with a full-canvas background
    rect (readability on any surface, e.g. GitHub's #0d1117 header)."""
    wm = wordmark_body(
        FLAT_DARK if dark else INK,
        ACCENT if dark else INK_ACCENT,
        LOCKUP_WM_PX,
        LOCKUP_WM_OX,
        LOCKUP_WM_OY,
    )
    mark_fill = FLAT_DARK if dark else FLAT_LIGHT
    accent_fill = ACCENT if dark else INK_ACCENT
    x, y, w, h = ACCENT_RECT
    mark = (
        f'<path fill="{mark_fill}" d="{MARK_PATH}"/>\n'
        f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{accent_fill}"/>'
    )
    if dark:
        head = f'<rect width="442" height="64" fill="{TILE}"/>\n  '
    else:
        head = ""
    total_w = 64 + LOCKUP_GAP + wordmark_total_width() * LOCKUP_WM_PX
    return svg_doc(
        f"{head}{mark}\n"
        f'  <g shape-rendering="crispEdges">\n    {wm}\n  </g>',
        total_w,
        64,
    )


def animated_svg() -> str:
    """SMIL: the three Z segments materialize top-to-bottom, then the amber
    cursor blinks. Same rhythm as the pixel-era animation (step 0.045s per
    segment, blink values 0;1;0.15;1 over 1.2s, infinite)."""
    step = 0.045 * 5  # 0.225s per segment (three segments ≈ the old 28-pixel cadence)
    segs = [
        f'<rect x="8" y="8" width="48" height="12" fill="{FLAT_DARK}" opacity="0">',
        f'<path fill="{FLAT_DARK}" d="M44 20L56 20 20 44 8 44Z" opacity="0">',
        f'<rect x="8" y="44" width="32" height="12" fill="{FLAT_DARK}" opacity="0">',
    ]
    closers = ["rect", "path", "rect"]
    parts = []
    for i, (seg, closer) in enumerate(zip(segs, closers)):
        begin = f"{i * step:.2f}s"
        animate = (
            f'<animate attributeName="opacity" from="0" to="1" begin="{begin}" '
            f'dur="0.001s" fill="freeze"/>'
        )
        parts.append(f"{seg}{animate}</{closer}>")
    total = 3 * step
    blink = (
        f'<rect x="44" y="44" width="12" height="12" fill="{ACCENT}" opacity="0">'
        '<animate attributeName="opacity" values="0;1;0.15;1" keyTimes="0;0.1;0.5;1" '
        f'begin="{total:.2f}s" dur="1.2s" repeatCount="indefinite"/></rect>'
    )
    body = "\n  ".join([*parts, blink])
    return svg_doc(body, 64, 64)


def social_svg() -> str:
    """1280x640 social card: flat mark x4 centered, wordmark, tagline."""
    bg = f'<rect width="1280" height="640" fill="{TILE}"/>'
    k = 4  # master geometry at 256px
    # Mark geometry at 256px via a transform group (identical to the master).
    mark = (
        f'<g transform="translate(512,140) scale(4)">\n'
        f'    <path fill="{FLAT_DARK}" d="{MARK_PATH}"/>\n'
        f'    <rect x="{ACCENT_RECT[0]}" y="{ACCENT_RECT[1]}" width="{ACCENT_RECT[2]}" height="{ACCENT_RECT[3]}" fill="{ACCENT}"/>\n'
        "  </g>"
    )
    wm_px = 8
    wm_w = wordmark_total_width() * wm_px
    wm = wordmark_body(FLAT_DARK, ACCENT, wm_px, (1280 - wm_w) // 2, 430)
    tag_px = 2
    tag_w = wordmark_width(TAGLINE) * tag_px
    tag = f'<path fill="{DIM}" d="{emit_cells(text_cells(TAGLINE), tag_px, (1280 - tag_w) // 2, 530)}"/>'
    return svg_doc(
        f"{bg}\n  {mark}\n"
        f'  <g shape-rendering="crispEdges">\n    {wm}\n  </g>\n'
        f'  <g shape-rendering="crispEdges">\n    {tag}\n  </g>',
        1280,
        640,
    )

def ascii_logo() -> str:
    lines = []
    for tr in range(len(GRID_TUI) // 2):
        line = ""
        for tc in range(len(GRID_TUI[0]) // 2):
            bits = 0
            for dr, dc, bit in ((0, 0, 1), (0, 1, 2), (1, 0, 4), (1, 1, 8)):
                if GRID_TUI[tr * 2 + dr][tc * 2 + dc]:
                    bits |= bit
            line += QUADRANT[bits]
        lines.append(line.rstrip())
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Rasterizer (pure stdlib, RGBA, src-over). Exact analytic coverage: each
# pixel's alpha is the area of the pixel square intersected with the polygon
# (Sutherland-Hodgman clip + shoelace, in exact rational arithmetic), so the
# 45-degree diagonal edges get smooth single-pixel AA and runs are bit-stable.
# ---------------------------------------------------------------------------

from fractions import Fraction as F  # noqa: E402


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

    def _in_rounded(self, px: float, py: float, x: float, y: float, w: float, h: float, r: float) -> bool:
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

    # -- exact analytic polygon coverage ------------------------------------

    @staticmethod
    def _clip_halfplane(poly, a, b, c):
        """Sutherland-Hodgman clip against a*x + b*y + c <= 0 (exact Fractions)."""
        out = []
        n = len(poly)
        if n == 0:
            return out

        def inside(p):
            return a * p[0] + b * p[1] + c <= 0

        def inter(p, q):
            px, py = p
            qx, qy = q
            d = a * (qx - px) + b * (qy - py)
            t = -(a * px + b * py + c) / d
            return (px + t * (qx - px), py + t * (qy - py))

        for i in range(n):
            cur, prev = poly[i], poly[(i - 1) % n]
            cin, pin = inside(cur), inside(prev)
            if cin:
                if not pin:
                    out.append(inter(prev, cur))
                out.append(cur)
            elif pin:
                out.append(inter(prev, cur))
        return out

    @classmethod
    def _clip_to_pixel(cls, poly, x0, y0):
        x0f, y0f = F(x0), F(y0)
        x1f, y1f = F(x0 + 1), F(y0 + 1)
        p = cls._clip_halfplane(poly, 1, 0, -x1f)   # x <= x1
        p = cls._clip_halfplane(p, -1, 0, x0f)      # x >= x0
        p = cls._clip_halfplane(p, 0, 1, -y1f)      # y <= y1
        p = cls._clip_halfplane(p, 0, -1, y0f)      # y >= y0
        return p

    @staticmethod
    def _area(poly) -> F:
        if len(poly) < 3:
            return F(0)
        s = F(0)
        n = len(poly)
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            s += x1 * y2 - x2 * y1
        return abs(s) / 2

    def fill_polygon(self, poly, color, fill_fn=None) -> None:
        """Fill a polygon with exact per-pixel analytic coverage.

        Scanline optimization: a pixel row [y, y+1) can only intersect an edge
        whose y-range spans it, so per row we clip only the *active* edges.
        Coverage itself is exact (Sutherland-Hodgman clip + shoelace area in
        rational arithmetic) — deterministic, no supersampling noise.
        fill_fn(x, y, coverage) customizes the color (sRGB gradient).
        """
        xs = [float(p[0]) for p in poly]
        ys = [float(p[1]) for p in poly]
        x_lo, x_hi = max(0, int(min(xs)) - 1), min(self.w, int(max(xs)) + 2)
        y_lo, y_hi = max(0, int(min(ys)) - 1), min(self.h, int(max(ys)) + 2)
        n = len(poly)
        edges = []
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            if y1 != y2:
                edges.append((min(y1, y2), max(y1, y2), poly[i], poly[(i + 1) % n]))
        fpoly = [(float(px), float(py)) for px, py in poly]
        for y in range(y_lo, y_hi):
            # candidate x-range for this row: from active edges
            row_x_lo, row_x_hi = x_lo, x_hi
            active = [e for e in edges if e[0] <= y < e[1] or e[0] < y + 1 <= e[1] or (e[0] <= y and e[1] >= y + 1)]
            if not active:
                # horizontal top/bottom edges: full row may still be inside
                # (e.g. solid rect polygons with two horizontal edges)
                row_x_lo, row_x_hi = x_lo, x_hi
            else:
                exs = []
                for _, _, p1, p2 in active:
                    exs.extend((p1[0], p2[0]))
                row_x_lo = max(x_lo, int(min(exs)) - 1)
                row_x_hi = min(x_hi, int(max(exs)) + 2)
            if row_x_lo >= row_x_hi:
                continue
            y0f, y1f = float(y), float(y + 1)
            for x in range(row_x_lo, row_x_hi):
                x0f, x1f = float(x), float(x + 1)
                # clip poly to pixel (4 half-planes); float is exact for these
                # integer-grid vertices (all intersections are dyadic rationals)
                q = self._clip_halfplane(fpoly, 1, 0, -x1f)
                q = self._clip_halfplane(q, -1, 0, x0f)
                q = self._clip_halfplane(q, 0, 1, -y1f)
                q = self._clip_halfplane(q, 0, -1, y0f)
                if len(q) < 3:
                    continue
                cov = self._area(q)
                if cov <= 0:
                    continue
                alpha = min(1.0, cov)
                if fill_fn is None:
                    self.blend(x, y, color, alpha)
                else:
                    self.blend(x, y, fill_fn(x, y), alpha)

    def fill_gradient_polygon(self, poly, c0, c1, x1, y1, x2, y2) -> None:
        """userSpaceOnUse linear gradient, sRGB interpolation (SVG 1.1 renders
        in linearRGB by default, but every modern renderer including resvg and
        the browsers interpolates in sRGB for this class of asset; we pin sRGB
        and golden-test against resvg)."""
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy

        def grad_at(px, py):
            # project pixel center onto the gradient axis
            t = ((px - x1) * dx + (py - y1) * dy) / L2
            t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            return (
                round(c0[0] + (c1[0] - c0[0]) * t),
                round(c0[1] + (c1[1] - c0[1]) * t),
                round(c0[2] + (c1[2] - c0[2]) * t),
                255,
            )

        self.fill_polygon(poly, None, fill_fn=lambda x, y: grad_at(x + 0.5, y + 0.5))

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


def scaled_poly(poly, s: float) -> list[tuple[float, float]]:
    return [(x * s, y * s) for x, y in poly]


def render_mark_png(size: int, dark: bool, gradient: bool) -> bytes:
    """Standalone mark render (master geometry + rounded tile).

    gradient=True uses the sRGB userSpaceOnUse gradient; False uses the flat
    fallback. Coverage (alpha) is identical either way — only the fill differs.
    """
    c = Canvas(size, size)
    s = size / 64
    rx = ICON_TILE_RX * s
    c.fill_rounded_rect(0, 0, size, size, rx, parse_color(TILE))
    if gradient:
        c.fill_gradient_polygon(
            scaled_poly(MARK_POLY, s), hex_rgb(GRAD0), hex_rgb(GRAD1), 8 * s, 8 * s, 56 * s, 56 * s
        )
    else:
        c.fill_polygon(scaled_poly(MARK_POLY, s), parse_color(FLAT_DARK))
    x, y, w, h = ACCENT_RECT
    c.fill_rect(x * s, y * s, w * s, h * s, parse_color(ACCENT))
    out = EXPORTS / "_tmp.png"
    c.write_png(out)
    data = out.read_bytes()
    out.unlink()
    return data


def render_bespoke_png(size: int) -> bytes:
    """Bespoke favicon tile: B16 grid scaled by k, flat colors."""
    c = Canvas(size, size)
    k = size / 16
    rx = size * FAVICON_TILE_RX_PER_PX
    c.fill_rounded_rect(0, 0, size, size, rx, parse_color(TILE))
    base, accent = parse_color(FLAT_DARK), parse_color(ACCENT)
    for x, y, w, h in B16_RUNS:
        c.fill_rect(x * k, y * k, w * k, h * k, base)
    x, y, w, h = B16_ACCENT
    c.fill_rect(x * k, y * k, w * k, h * k, accent)
    out = EXPORTS / "_tmp.png"
    c.write_png(out)
    data = out.read_bytes()
    out.unlink()
    return data


def render_social_png(path: Path) -> None:
    """Flat-mark social card raster (embedded surfaces are always flat)."""
    c = Canvas(1280, 640)
    c.fill_rect(0, 0, 1280, 640, parse_color(TILE))
    # mark at 256px, centered horizontally, top at y=140 (scale 4 of the 64-grid)
    s = 4.0
    c.fill_polygon(scaled_poly(MARK_POLY, s), parse_color(FLAT_DARK))
    # shift: fill_polygon draws at origin; we need translate(512,140). Simplest:
    # rebuild canvas with offset — instead render onto an offset subcanvas.
    # Easier: use a translated polygon.
    mark = [(512 + x * 4, 140 + y * 4) for x, y in MARK_POLY]
    c2 = Canvas(1280, 640)
    c2.fill_rect(0, 0, 1280, 640, parse_color(TILE))
    c2.fill_polygon(mark, parse_color(FLAT_DARK))
    ax, ay, aw, ah = ACCENT_RECT
    c2.fill_rect(512 + ax * 4, 140 + ay * 4, aw * 4, ah * 4, parse_color(ACCENT))
    wm_px = 8
    wm_w = wordmark_total_width() * wm_px
    ox = (1280 - wm_w) // 2
    for col, row in text_cells(WORDMARK_TEXT):
        c2.fill_rect(ox + col * wm_px, 430 + row * wm_px, wm_px, wm_px, parse_color(FLAT_DARK))
    cx = ox + (wordmark_width(WORDMARK_TEXT) + 1) * wm_px
    c2.fill_rect(cx, 430, 5 * wm_px, 7 * wm_px, parse_color(ACCENT))
    tag_px = 2
    tag_w = wordmark_width(TAGLINE) * tag_px
    tox = (1280 - tag_w) // 2
    for col, row in text_cells(TAGLINE):
        c2.fill_rect(tox + col * tag_px, 530 + row * tag_px, tag_px, tag_px, parse_color(DIM))
    c2.write_png(path)


# ---------------------------------------------------------------------------
# Alpha-equality self-check: flat vs gradient renders must differ only in
# fill, never in coverage.
# ---------------------------------------------------------------------------

def assert_alpha_equal(a: bytes, b: bytes, label: str) -> None:
    wa, ha = struct.unpack(">II", a[16:24])
    wb, hb = struct.unpack(">II", b[16:24])
    assert (wa, ha) == (wb, hb), label

    def alpha_plane(data):
        # decode IDAT (single zlib stream of filtered scanlines, RGBA8)
        w, h = struct.unpack(">II", data[16:24])
        # walk chunks to find IDAT
        off = 8
        idat = b""
        while off < len(data):
            ln = struct.unpack(">I", data[off : off + 4])[0]
            tag = data[off + 4 : off + 8]
            if tag == b"IDAT":
                idat += data[off + 8 : off + 8 + ln]
            off += 12 + ln
        raw = zlib.decompress(idat)
        stride = w * 4
        out = bytearray()
        prev = bytearray(stride)
        pos = 0
        for _ in range(h):
            f = raw[pos]
            line = bytearray(raw[pos + 1 : pos + 1 + stride])
            pos += 1 + stride
            if f == 0:
                pass
            elif f == 1:
                for i in range(4, stride):
                    line[i] = (line[i] + line[i - 4]) & 0xFF
            elif f == 2:
                for i in range(stride):
                    line[i] = (line[i] + prev[i]) & 0xFF
            elif f == 3:
                for i in range(stride):
                    left = line[i - 4] if i >= 4 else 0
                    line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
            elif f == 4:
                for i in range(stride):
                    a_ = line[i - 4] if i >= 4 else 0
                    b_ = prev[i]
                    cc = prev[i - 4] if i >= 4 else 0
                    p = a_ + b_ - cc
                    pa, pb, pc = abs(p - a_), abs(p - b_), abs(p - cc)
                    pr = a_ if (pa <= pb and pa <= pc) else (b_ if pb <= pc else cc)
                    line[i] = (line[i] + pr) & 0xFF
            out += line[3::4]
            prev = line
        return bytes(out)

    aa, ab = alpha_plane(a), alpha_plane(b)
    assert aa == ab, f"{label}: flat and gradient renders differ in alpha (coverage)"


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
        w, h, _c, _r, planes, bpp, size, off = struct.unpack(
            "<BBBBHHII", data[6 + 16 * i : 22 + 16 * i]
        )
        assert (256 if w == 0 else w, 256 if h == 0 else h) == (ew, eh)
        assert planes == 1 and bpp == 32, (path.name, ew)
        assert data[off : off + 8] == b"\x89PNG\r\n\x1a\n"
        pw, ph = struct.unpack(">II", data[off + 16 : off + 24])
        assert (pw, ph) == (ew, eh), (path.name, ew, (pw, ph))
        assert off + size <= len(data)


# ---------------------------------------------------------------------------
# ICNS — Apple icon image: 'icns' magic + total length, then a stream of
# entries (4-char OSType + entry length incl. its 8-byte header + PNG payload).
# Modern macOS accepts PNG-compressed entries at every size below.
# ---------------------------------------------------------------------------

ICNS_ENTRIES = [
    ("ic07", 128),   # 128 pt
    ("ic08", 256),   # 256 pt
    ("ic09", 512),   # 512 pt
    ("ic10", 1024),  # 512 pt @2x
    ("ic11", 32),    # 16 pt @2x
    ("ic12", 64),    # 32 pt @2x
    ("ic13", 256),   # 128 pt @2x
    ("ic14", 512),   # 256 pt @2x
]


def build_icns(pngs: dict[int, bytes]) -> bytes:
    body = b""
    for ostype, size in ICNS_ENTRIES:
        data = pngs[size]
        body += ostype.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    return b"icns" + struct.pack(">I", len(body) + 8) + body


def verify_icns(path: Path, expected: list[str]) -> None:
    data = path.read_bytes()
    assert data[:4] == b"icns"
    assert struct.unpack(">I", data[4:8])[0] == len(data)
    off, found = 8, []
    while off < len(data):
        ostype = data[off : off + 4].decode("ascii")
        entry_len = struct.unpack(">I", data[off + 4 : off + 8])[0]
        assert data[off + 8 : off + 16] == b"\x89PNG\r\n\x1a\n", ostype
        assert entry_len >= 8 and off + entry_len <= len(data), ostype
        pw, ph = struct.unpack(">II", data[off + 16 : off + 24])
        nominal = dict((s, t) for t, s in ICNS_ENTRIES).get(ostype)
        if nominal:
            assert (pw, ph) == (nominal, nominal), (ostype, (pw, ph))
        found.append(ostype)
        off += entry_len
    assert found == expected and off == len(data)


# ---------------------------------------------------------------------------
# Consumer sync — every in-repo consumer of a brand asset is a byte-for-byte
# copy of a generated file. Regenerating + syncing keeps one source of truth.
# ---------------------------------------------------------------------------

CONSUMER_COPIES = [
    ("icon-mono.svg", "apps/vscode/resources/zimi-icon.svg"),
    ("exports/icon-128.png", "apps/vscode/resources/zimi-icon-storefront.png"),
    ("exports/icon-128.png", "apps/vscode/webview-ui/public/zimi-logo.png"),
    ("wordmark-light.svg", "apps/vscode/webview-ui/public/zimi-banner-light.svg"),
    ("wordmark-dark.svg", "apps/vscode/webview-ui/public/zimi-banner-dark.svg"),
    ("exports/favicon.ico", "docs/public/favicon.ico"),
    ("exports/favicon.ico", "apps/zimi-code/dist-web/favicon.ico"),
    ("exports/icon.ico", "apps/zimi-desktop/build/icon.ico"),
    ("exports/icon.icns", "apps/zimi-desktop/build/icon.icns"),
    ("exports/icon-512.png", "apps/zimi-desktop/build/icon.png"),
]

DESKTOP_LINUX_ICON_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]


def md5_of(path: Path) -> str:
    import hashlib

    return hashlib.md5(path.read_bytes()).hexdigest()


def sync_consumers() -> None:
    for src_rel, dst_rel in CONSUMER_COPIES:
        src, dst = ROOT / src_rel, REPO / dst_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        assert md5_of(src) == md5_of(dst), dst_rel
        print(f"  sync: {dst_rel}")
    icons_dir = REPO / "apps/zimi-desktop/build/icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    for size in DESKTOP_LINUX_ICON_SIZES:
        src = EXPORTS / f"icon-{size}.png"
        dst = icons_dir / f"{size}x{size}.png"
        shutil.copyfile(src, dst)
        assert md5_of(src) == md5_of(dst), dst
    print(f"  sync: apps/zimi-desktop/build/icons/ ({len(DESKTOP_LINUX_ICON_SIZES)} pngs)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

EXPORT_PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]


def main() -> None:
    EXPORTS.mkdir(parents=True, exist_ok=True)
    svgs = {
        "icon.svg": icon_svg(),
        "icon-mono.svg": mono_svg(),
        "favicon-16.svg": favicon_svg(16),
        "favicon-32.svg": favicon_svg(32),
        "favicon-48.svg": favicon_svg(48),
        "wordmark-dark.svg": wordmark_svg(dark=True),
        "wordmark-light.svg": wordmark_svg(dark=False),
        "lockup-dark.svg": lockup_svg(dark=True),
        "lockup-light.svg": lockup_svg(dark=False),
        "animated.svg": animated_svg(),
        "social-preview.svg": social_svg(),
        "mark-mono-16.svg": mono16_svg(),
    }
    for name, content in svgs.items():
        with open(ROOT / name, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(content)
    with open(ROOT / "ascii.txt", "w", encoding="utf-8", newline="\n") as fh:
        fh.write(ascii_logo())

    # Pinned-master byte checks: these files are the sign-off artifacts; if the
    # generator drifts, the golden evidence under .tmp/ no longer applies.
    pinned = {
        "icon-mono.svg": (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n'
            f'  <path fill="currentColor" d="{MARK_PATH}"/>\n'
            f'  <rect x="44" y="44" width="12" height="12" fill="currentColor"/>\n'
            "</svg>\n"
        ),
    }
    for name, content in pinned.items():
        assert svgs[name] == content, f"{name}: drifted from pinned master"

    png_by_size: dict[int, bytes] = {}
    for size in EXPORT_PNG_SIZES:
        if size <= 48:
            # bespoke derivations (independent geometry, flat, tile)
            data = render_bespoke_png(size)
        else:
            gradient = size >= STANDALONE_GRADIENT_MIN_PX
            data = render_mark_png(size, dark=True, gradient=gradient)
        png_by_size[size] = data
        (EXPORTS / f"icon-{size}.png").write_bytes(data)

    # Alpha-equality self-check (checklist 4.2): flat vs gradient renders must
    # have identical coverage at every gradient-capable size.
    for size in (64, 128, 256, 512, 1024):
        flat = render_mark_png(size, dark=True, gradient=False)
        grad = render_mark_png(size, dark=True, gradient=True)
        assert_alpha_equal(flat, grad, f"icon-{size}")

    (EXPORTS / "favicon.ico").write_bytes(
        build_ico([png_by_size[s] for s in (16, 32, 48)])
    )
    (EXPORTS / "icon.ico").write_bytes(
        build_ico([png_by_size[s] for s in (16, 32, 48, 64, 128, 256)])
    )
    (EXPORTS / "icon.icns").write_bytes(build_icns(png_by_size))
    render_social_png(EXPORTS / "social-preview.png")

    import xml.dom.minidom

    for name in svgs:
        xml.dom.minidom.parse(str(ROOT / name))
    verify_ico(EXPORTS / "favicon.ico", [(16, 16), (32, 32), (48, 48)])
    verify_ico(
        EXPORTS / "icon.ico",
        [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    verify_icns(EXPORTS / "icon.icns", [ostype for ostype, _ in ICNS_ENTRIES])
    for png in sorted(EXPORTS.glob("*.png")):
        data = png.read_bytes()
        assert data[:8] == b"\x89PNG\r\n\x1a\n", png
        w, h = struct.unpack(">II", data[16:24])
        if png.stem == "social-preview":
            assert (w, h) == (1280, 640), (png.name, (w, h))
        else:
            nominal = int(png.stem.split("-")[1])
            assert (w, h) == (nominal, nominal), (png.name, (w, h), nominal)
        print(f"  {png.name}: {w}x{h} {len(data)}B")
    rows = ascii_logo().splitlines()
    assert rows == ["▀▀▀█▛", "▄██▖▄"], rows
    print(f"ascii: {rows}")
    sync_consumers()
    print("build OK")


if __name__ == "__main__":
    main()
