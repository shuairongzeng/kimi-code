# Zimi Code Brand

One bitmap, two native renderers. The mark is a 10×4 pixel **Z** — the SVG
below draws it pixel by pixel; the terminal logo is the *same bitmap* encoded
as Unicode quadrant blocks. The GUI is the CLI's second renderer.

```
▀▀▜█▀        pixels:  phosphor green on a terminal-dark tile
▄█▙▄▄        last pixel of the bottom bar: amber — the cursor
             resting at the end of the output, agent standing by
```

## Palette

| Role | Hex | Use |
|---|---|---|
| Screen | `#0C1210` | icon tile, social card background |
| Pixel | `#7EE787` | the Z, wordmark on dark |
| Cursor | `#FFBF47` | the single accent pixel / wordmark cursor |
| Ink | `#144024` | wordmark on light surfaces |
| Ink cursor | `#D97706` | cursor on light surfaces |

## Files

| File | Purpose |
|---|---|
| `icon.svg` | master icon (tile + pixels), any surface |
| `icon-mono.svg` | `currentColor`, no tile — toolbars, activity bars |
| `favicon-16.svg` / `favicon-48.svg` | bespoke small-size derivations |
| `wordmark-dark.svg` / `wordmark-light.svg` | pixel "ZIMI CODE" + cursor |
| `lockup-dark.svg` / `lockup-light.svg` | icon + wordmark, README headers |
| `animated.svg` | SMIL: pixels materialize, cursor blinks |
| `social-preview.svg` | 1280×640 social card source |
| `ascii.txt` | the TUI logo (`▀▀▜█▀` / `▄█▙▄▄`) |
| `exports/` | rendered PNGs (16–1024), `favicon.ico`, `social-preview.png` |

## Rules

- Clear space: one module (6 units on the 64-grid) on all sides.
- Minimum sizes: icon 16 px, lockup 24 px tall, wordmark 12 px tall.
- The color icon carries its own tile — safe on any background. Use the mono
  version where the host tints icons (toolbars, activity bars).
- Don't: recolor pixels, add gradients/shadows, rotate, stretch, soften the
  pixel edges, or retypeset the wordmark in a different font.
- 16 px favicon uses the bespoke derivation (`favicon-16.svg`), never a
  downscale of the master.

## Regenerate

```
python brand/scripts/build.py
```

Pure stdlib. Rewrites every SVG master, every PNG in `exports/`, and
`favicon.ico` from the bitmap and font data in the script.
