# Zimi Code Brand

Prism. A solid geometric **Z** — two horizontal bars and a diagonal band on a
64-unit integer grid — with an **amber square** in the bottom-right corner:
the terminal cursor, resting at the end of the output, agent standing by.

The GUI renders the vector masters in this directory. The terminal logo
(`ascii.txt`) is a **documented approximation**: a hand-designed 10×4
quadrant-block grid that evokes the same three strokes + separated cursor
motif. It is not a second renderer of a shared bitmap — the mark has no
bitmap source.

```
▀▀▀█▛        three strokes: full-width top bar, diagonal, bottom bar
▄██▖▄        amber cursor: the last cell of row 1 — separated by one column,
             the same gap motif as the 16px favicon
```

## Palette

| Role | Hex | Use |
|---|---|---|
| Tile | `#0C1210` | terminal-dark screen behind every export |
| Gradient start | `#2DD4BF` | teal, dark-surface gradient (large color) |
| Gradient end | `#7EE787` | phosphor green, dark-surface gradient + flat dark fill |
| Cursor | `#FFBF47` | VT220 amber accent (dark surfaces) |
| Ink gradient start | `#0D9488` | light-surface gradient (large color) + flat light fill |
| Ink gradient end | `#16A34A` | light-surface gradient |
| Ink cursor | `#D97706` | amber readable on white |
| Ink | `#144024` | wordmark on light surfaces |
| Dim | `#3E7A54` | taglines |

## Gradient policy (surface-based, not size-based)

The gradient is a large-format color treatment, deliberately restricted:

- **Standalone color exports ≥ 128 px** (`icon-128/256/512/1024.png`) carry
  the `userSpaceOnUse` sRGB linear gradient `#2DD4BF → #7EE787` (axis
  8,8 → 56,56 on the 64-grid).
- **Embedded marks** — the lockup (64 px icon inside) and the social card
  (256 px icon inside) — always use the flat fill `#7EE787`: the gradient
  reads as noise next to a wordmark, and the lockup is the brand's most
  reproduced surface.
- **The 64 px app icon** (`icon.svg`, `icon-64.png`) uses the flat fill for
  the same reason (16–64 px is the icon's main working range).
- **Bespoke 16/32/48 px derivations** and **all mono assets** are flat by
  design; a gradient adds nothing at pixel-grid sizes.
- Flat and gradient renders of the same geometry share identical coverage
  (alpha); only the fill differs. `build.py` asserts this per size.

## Files

| File | Purpose |
|---|---|
| `icon.svg` | app icon: tile + mark, flat dark (main working range) |
| `icon-mono.svg` | the mark, single `currentColor` paths, no tile — host-tinted contexts |
| `mark-mono-16.svg` | bespoke mono 16px: same grid as `favicon-16`, no tile |
| `favicon-16.svg` / `favicon-32.svg` / `favicon-48.svg` | bespoke small-size tiles (never downscales) |
| `wordmark-dark.svg` / `wordmark-light.svg` | pixel "ZIMI CODE" + cursor |
| `lockup-dark.svg` / `lockup-light.svg` | icon + wordmark, 442×64; dark leads with a full-canvas `#0C1210` rect |
| `animated.svg` | SMIL: top bar → diagonal → bottom bar materialize, cursor blinks |
| `social-preview.svg` | 1280×640 social card source |
| `ascii.txt` | the TUI logo (`▀▀▀█▛` / `▄██▖▄`) |
| `exports/` | rendered PNGs (16–1024), `favicon.ico`, `icon.ico`, `icon.icns`, `social-preview.png` |

## Rules

- Clear space: 8 units on the 64-grid (one bar height) on all sides.
- Minimum sizes: icon 16 px, lockup 24 px tall, wordmark 12 px tall.
- The color icon carries its own tile — safe on any background. Use the mono
  version where the host tints icons (toolbars, activity bars).
- Don't: recolor, rotate, stretch, add shadows or blur, or retypeset the
  wordmark in a different font.
- Gradients: only where the policy above allows (standalone ≥ 128 px color).
  Everywhere else use the flat fill. Never introduce a second gradient.
- 16 px favicon/ico entries use the bespoke derivation (`favicon-16.svg`
  grid), never a downscale of the master. The mono 16px is bespoke on the
  same grid (`mark-mono-16.svg`), not the master path scaled — at that size
  the master reads as a prompt "›" instead of a Z.
- Tile color is the named constant `TILE = #0C1210`, shared by every export
  surface (favicons, `.ico`, `.icns`, social card, lockup-dark background).

## Regenerate

```
python brand/scripts/build.py
```

Pure stdlib (struct + zlib + fractions; no PIL, no resvg). Rewrites every
SVG master, every PNG in `exports/`, `favicon.ico`, `icon.ico`, `icon.icns`,
`social-preview.png`, and `ascii.txt`, then syncs the in-repo consumers
(VS Code resources, webview public files, docs favicon, dist-web favicon,
zimi-desktop build icons). Byte-deterministic: two consecutive runs produce
identical files. The rasterizer computes exact analytic per-pixel coverage
(Sutherland–Hodgman clip + shoelace area) so the diagonal edges get
single-pixel AA without supersampling noise; the gradient interpolates in
sRGB, golden-tested against `@resvg/resvg-js` (see
`.tmp/verify/out/final/golden-resvg.txt`).
