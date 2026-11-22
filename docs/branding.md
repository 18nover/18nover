# Branding

The company site shares visual tokens with OnlyMen so the two properties read as one family. Tokens live in `app/globals.css` and are loaded as CSS variables on `:root`.

## Color

| Token | Hex | CSS variable |
|---|---|---|
| Ink | `#0a0809` | `--color-ink` |
| Night | `#120d0e` | `--color-night` |
| Surface | `#1a1314` | `--color-surface` |
| Surface 2 | `#241a1b` | `--color-surface-2` |
| Line | `#3a2b2c` | `--color-line` |
| Ivory | `#f4ead7` | `--color-ivory` |
| Muted | `#b3a493` | `--color-muted` |
| Dim | `#7d6f63` | `--color-dim` |
| Gold | `#d4af6a` | `--color-gold` |
| Gold highlight | `#f3dca0` | `--color-gold-hi` |
| Gold low | `#96702f` | `--color-gold-lo` |
| Oxblood | `#5c0d1b` | `--color-oxblood` |
| Ruby | `#c22a45` | `--color-ruby` |

The core set used in conversation and design references is ink, gold, oxblood, ruby, and ivory. Theme color in the layout metadata is ink (`#0a0809`).

## Type

- Display / headings: **Cormorant Garamond** (`--font-display`, loaded in `app/layout.tsx`)
- Body / UI: **Manrope** (`--font-sans`)

## Voice and lines

- Hero / tagline: “Built for Men. Made for Grown-Ups.” (`lib/config.ts` and the homepage hero)
- Positioning: 18nover is an adults-only company, built by and for gay men, and is the parent company behind OnlyMen.

Do not invent a phone number, street address, or live support hours. The site already says email is the only contact path.

## Crest and icons

The 18nover crest is the company mark and is used on this site as the logo, favicon, and Open Graph image. Files are in `public/` (full crest, icon crops, favicon, `apple-touch-icon.png`, `og.jpg`). A local working set also exists on the shared workspace under `logo/`; `public/` in this repo is what ships.

Treat the crest as brand identity. Do not restyle it casually or reuse it outside 18nover / OnlyMen without Jerry’s say-so.
