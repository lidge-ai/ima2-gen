# ima2-gen Design System

Living reference for the visual system. Update this file whenever tokens,
scales, or policies change.

## Product profile

```
DESIGN_VARIANCE: 3
MOTION_INTENSITY: 2
Product density: D5
```

ima2-gen is a repeated-expert creative tool. D5 density prioritizes
information density and scan speed over decorative whitespace. Liquid
Editorial or marketing-style composition is out of scope.

## Color tokens

Theme direction: `:root` is **dark** (default), `:root[data-theme="light"]`
is light.

### Surfaces

| Token | Dark | Light | Role |
|-------|------|-------|------|
| `--bg` | `#0b0b0f` | `#f2f2f6` | Page background |
| `--surface` | `#14141a` | `#eaeaef` | Card/panel background |
| `--surface-2` | `#1c1c23` | `#e2e2e9` | Raised surface |
| `--surface-3` | `#26262f` | `#d8d8e0` | Tertiary surface |
| `--paper` | `#14161b` | `#ffffff` | Canvas blank sheet |
| `--paper-edge` | `#1b1e25` | `#f8fafc` | Canvas sheet edge gradient |

### Text

| Token | Dark | Light | Role |
|-------|------|-------|------|
| `--text` | `#f4f4f6` | `#14141a` | Primary |
| `--text-dim` | `#b6b6c2` | `#5d5d68` | Secondary |
| `--text-muted` | `#90909d` | `#5d5d68` | Tertiary |
| `--text-faint` | `#55555f` | `#9e9ea8` | Disabled/hint |

### State colors

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--red` | `#ef4444` | `#cc3340` | Error, danger, destructive |
| `--amber` | `#f59e0b` | `#a96a06` | Warning, caution |
| `--green` | `#22c55e` | `#178a43` | Success, positive |
| `--blue` | `#4a9eff` | `#1d6fd1` | Info, neutral highlight |

Deleted aliases: `--danger`, `--error`, `--success`, `--warn`, `--warning`,
`--info`, `--bg-primary`, `--bg-raised`, `--shadow`, `--agent-rail-ring`,
`--text-primary`, `--text-secondary`, `--control-bg-hover`, `--surface-hover`,
`--surface-raised`, `--surface-4`, `--font-ui`, `--font-mono`. Use the
canonical token names above.

### Borders and controls

| Token | Dark | Light | Role |
|-------|------|-------|------|
| `--border` | `#26262f` | `#d8d8e0` | Default border |
| `--border-strong` | `#3d3d49` | `#c0c0ca` | Emphasized border |
| `--hairline` | `rgba(255,255,255,0.16)` | `rgba(20,20,28,0.16)` | Subtle divider |
| `--control-bg` | `rgba(255,255,255,0.03)` | `rgba(20,20,28,0.03)` | Control fill |
| `--control-hover` | `rgba(255,255,255,0.08)` | `rgba(20,20,28,0.08)` | Control hover |
| `--accent` | `#f0f0f4` | `#14141a` | Primary action |
| `--focus-ring` | `rgba(122,215,255,0.35)` | `rgba(29,111,209,0.35)` | Focus indicator |

### Decorative

| Token | Role |
|-------|------|
| `--prism` | Rainbow gradient for branding |
| `--chrome` | Metallic gradient for the `ima2` wordmark text |
| `--glass` | Frosted glass overlay |
| `--skeleton-shimmer` | Loading skeleton animation gradient |

## Brand mark

The mark is a rounded numeral "2" with a dot above its left shoulder, read as "i2". It is monochrome everywhere; colour never carries the brand.

| Asset | Use |
|-------|-----|
| `assets/brand/mark.svg` | Vector mark, `fill="currentColor"`. UI (`ui/public/brand-mark.svg` via `BrandMark`), site header, macOS menubar template icon |
| `assets/brand/favicon.svg` | Graphite tile (`#1c1d21`) with the mark in `#f2f3f5`. UI and site favicon, Windows/Linux tray, apple-touch-icon |
| `assets/brand/icon-1024.png` (= `assets/logo.png`) | Liquid-metal app icon on a graphite tile. Desktop app icon and README |
| `assets/brand/mark-chrome.png` | Liquid-metal mark without the tile. Desktop loading screen and large brand moments |

Rules: the flat mark takes the surrounding text colour; the chrome rendering is reserved for the app icon and loading screen. Do not recolour, outline or add effects to the flat mark. Keep clear space of at least half the mark width.

## Typography

### Font stacks

| Token | Stack |
|-------|-------|
| `--font` | Satoshi, Pretendard Variable, system-ui, sans-serif |
| `--font-display` | Clash Display, Pretendard Variable, system-ui, sans-serif |
| `--mono` | IBM Plex Mono, SF Mono, Menlo, monospace |

### Rules

- **Letter spacing must be 0.** No negative letter-spacing anywhere.
- **No viewport-scaled font-size.** Use stepped media-query ladders instead.
- Mono is for status chips, aspect ratios, resolutions, shortcuts, token
  counts, IDs. Human-language labels use `--font`.

### Type ladders (Home hero)

| Selector | <=480 | <=1024 | <=1279 | >=1280 |
|----------|-------|--------|--------|--------|
| `.home-hero__mark` | 100px | 125px | 150px | 176px |
| `.home-hero__title` | 28px | - | 30px | 34px |
| `.home-workspace__recent > h2` | - | - | 22px | 26px |
| `.assets-tile__glyph` | 40px | 52px (<=768) | 64px | 72px |

## Radius scale

Eight steps, defined in `:root` only. No component or theme block may
redefine these values.

| Token | Value | Usage |
|-------|-------|-------|
| `--r-xs` | 4px | Inline badges, thumbnails |
| `--r-sm` | 6px | Buttons, inputs, small controls |
| `--r-md` | 8px | Cards, panels (cap for cards) |
| `--r-lg` | 10px | Modals, toasts, gallery |
| `--r-xl` | 12px | Large containers |
| `--r-2xl` | 16px | Overlays |
| `--r-3xl` | 20px | Full-page panels |
| `--r-pill` | 999px | Pills, chips, toggles |

Cards are capped at `--r-md` (8px) unless the design system requires
otherwise.

## Gradients

Total budget: **40** gradient function calls.

| Category | Count | Examples |
|----------|-------|----------|
| Functional | 18 | Checkerboard grids, alpha grids, coordinate grids, masks |
| State | 6 | Skeleton shimmer (1 token + 6 refs), progress ring, success |
| Scrim | 2 | Caption overlay, top scrim |
| Decorative | 14 | Brand gradients, message surfaces, skeleton text |

Per-file decorative cap: 3. New gradients must be registered in the
manifest at `tests/ui-gradient-manifest-contract.test.ts`.

## Touch targets

Two minimums:

- **24px (WCAG 2.5.8 AA)**: all interactive elements.
- **44px hit area**: icon-only controls. Implemented via `::after`
  pseudo-element overlay or actual size increase.

Exemptions require documented rationale (density conflict, layout
constraint) and must still meet 24px AA.

## Motion

A global `prefers-reduced-motion` reset at `index.css` covers all
animations. MOTION_INTENSITY 2: subtle transitions only, no decorative
animation. Skeleton shimmer is the only repeating animation.

## Verification

### Composer contract (WP08)

Preserve the expert-tool V3/M2/D5 profile. `styles/composer-panes.css` owns the
paired editing surface; host allocation stays with sidebar/dock/sheet styles.
The enabled placeholder and identifying border use `--text-muted`, not decorative
hairlines or reduced placeholder opacity. Classic panes use `--r-md` for both
border radius and clipping, preventing disconnected corners. Home keeps its
effective `--r-xl` input radius. Focus tokens and disabled controls are unchanged.
The fixed mobile navigation uses opaque `--bg`, preventing underlying scrolling
text from bleeding into its labels; dimensions, safe areas and navigation stay.

Runtime CSS in `ui/src/index.css` is authoritative; the older global token tables
above are historical snapshots, not rendered-color evidence. The scoped current
pairs are dark muted#90909d on surface2#1c1c23 and light#5d5d68 on#ececf1. Actual
hosted tests composite ancestor/pseudo opacity and compare PNG background samples;
they do not certify all controls or the whole application as WCAG-conformant.
Current implementation evidence belongs to `devlog/_fin/260905_production_readiness/084*`.

Render proof (wp7): 16/16 live Playwright checks passed at commit
`635723d7`. Verified: radius tokens, type ladders at 1280px and 320px,
paper/state color tokens in computed style, settings-workspace
background-image none, skeleton-shimmer token active.
