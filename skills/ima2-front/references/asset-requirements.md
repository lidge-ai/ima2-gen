# Asset Requirements

Visual surfaces need real visual evidence. Abstract backgrounds, blobs, and generic icons are not enough when users need to understand a product, place, object, workflow, game, or state.

## Asset Decision Table

| Surface | Required Asset Type |
| --- | --- |
| Product / object / venue / person page | real or generated bitmap showing the subject |
| Marketing / landing page | concrete product, scene, screenshot, or generated hero image |
| Dashboard / tool | real state preview, chart, table, workflow screenshot, or diagram |
| AI tool | process state, provenance, result preview, permission boundary, or diagram |
| Education / kids / community | illustration, character, or guided visual allowed |
| Fintech / gov / B2B | restrained screenshot, data view, trust visual, or high-polish semantic 3D |
| Game | game assets mandatory |
| Documentation | screenshots or diagrams when they clarify a task |

## What Does Not Count

- abstract gradient mesh
- decorative blob/orb
- generic icon row
- fake dashboard with random numbers
- low-polish AI image
- stock photo unrelated to the task
- public 3D icon pack used without brand adaptation
- integration/partner logo wall using generic icons instead of brand SVGs (see `brand-asset-sourcing.md`)

## Asset Sourcing Workflow

This source-priority list applies to CONTENT assets used in builds: photos,
illustrations, textures, motion clips, screenshots, diagrams, charts, and
brand-safe SVGs. The concept-mockup pass in `ima2-uiux` is a process
step outside this sourcing order; when its trigger fires, it runs before code
even though its outputs are not shippable UI pixels.

For build assets, try each source in order. Stop at the first that produces a
usable asset.

| Priority | Source | When to Use |
|----------|--------|-------------|
| 1 | Project existing assets | `images/`, `public/`, `assets/` in the repo |
| 2 | `ima2` CLI (canonical) or `ima2 gen` skill fallback | Hero images, product shots, custom illustrations, textures, and motion assets. Probe `ima2 status`; if unavailable, attempt `ima2 serve` and re-check before falling back. Use `ima2 gen`, `ima2 edit`, or `ima2 video` with a detailed prompt per § Agent Image Prompt Protocol. Fall back to `ima2 gen` only when ima2 is truly unavailable |
| 3 | Stock photo API | `source.unsplash.com/800x600/?coffee`, Pexels. Always include `alt` text and credit |
| 4 | CSS device frame + screenshot | App mockup heroes (Toss/카카오 style). Pure CSS phone/laptop frame wrapping a real screenshot or UI |
| 5 | Placeholder service (last resort) | `picsum.photos/800/600`, `placehold.co`. Mark as TODO for replacement |

### Raster vs real vector

An image prompted as "flat vector style" is still a raster bitmap. When the shipped
asset must contain scalable paths (logo mark, icon, simple sprite, stencil), generate a
clean flat or transparent raster first, then run:

```bash
ima2 vectorize input.png -o output.svg --preset auto --json
```

The same tracer is available in AssetGen, Assets, and Canvas Mode. In Canvas Export,
choose **Trace to SVG (vector)**; **SVG (embedded raster)** is self-contained but is
not a pixel trace. Inspect path count and render the SVG back to PNG before shipping.
Tracing works best for flat color, strong edges, cutouts, and logos; photographs,
gradients, and small text are not acceptable vectorization targets.

### Korean Service Patterns

Korean product pages almost always use concrete visual evidence in the first viewport:

| Pattern | Example | Implementation |
|---------|---------|---------------|
| Device mockup hero | Toss, 카카오뱅크, 당근 | CSS device frame (`border-radius: 40px`, `box-shadow`) + app screenshot inside |
| Real product photo | 배민, 무신사, 마켓컬리 | Full-bleed or contained product image, not a gradient placeholder |
| App screenshot carousel | 토스, 네이버 | Horizontal scroll of actual app screens |
| Data visualization hero | 토스증권, 뱅크샐러드 | Real (or realistic) chart/graph as primary visual |

Never ship a Korean-facing product page with only SVG icons and text. If no image source is available, state the gap explicitly rather than filling with gradients or decorative shapes.

## Mockup Production Pipeline (verified 2026-07-09)

When a product/device mockup asset is required (product-led heroes, app
screenshots in scenes):

- **Device-mockup tools** (Rotato, MockRocket, Shots, Smartmockups, Figma
  mockup plugins): map a real screenshot onto a 3D device render; stills and
  short movies, no 3D skills needed.
- **AI scene + real screenshot compositing**: generate the environment/scene
  image, then composite the actual product UI screenshot into or above it;
  never AI-generate the shipped product UI itself - the interface pixels must
  be real in shipped assets.
- **Frame extraction**: for scroll-driven playback, render the mockup motion
  to video and extract frames (see motion.md § Frame Sequence Format Guide).

The screenshot inside any mockup must be a real, current capture of the
product; a fabricated UI in a real frame is still a fake asset.

### Concept Mockup Boundary (FE-ASSET-CONCEPT-01, DEFAULT)

Generated CONCEPT mockups of a page or component, including `ima2` concept
passes and mockup references, are exploration artifacts. They are legal and
encouraged before code when the concept-pass trigger fires, but they must never
ship as UI pixels.

The "never AI-generate the product UI itself" rule is scoped to shipped
assets. It does not ban pre-code concept exploration, and it does not ban
generated photographic, texture, illustration, or motion CONTENT assets in real
builds. Those content assets are not product UI pixels; they may ship when
they satisfy provenance, licensing, accessibility, performance, and visual QA
requirements.

## Rules

- Use the repo's existing asset system first.
- If no asset exists and the surface needs one, follow the sourcing workflow above.
- For external or generated assets, record provenance/licensing in the dev note, PR description, or project asset manifest when one exists.
- For captured third-party reference material, use `reference-capture.md` and keep the required manifest next to the capture. Captured assets never move into shipped project assets.
- Make the first viewport identify the product/place/object when relevant.
- Do not obscure text or primary actions with visuals.
- Verify assets render on mobile and desktop.
- Verify intrinsic dimensions, aspect ratio, crop, alt text, and loading behavior.
- Optimize heavy media; do not ship huge 3D/video assets without a reason.
- Ship gate: no captured third-party asset may appear in the shipped build.

## Agent Image Prompt Protocol

### Long Prompt and Motion Rule (FE-ASSET-PROMPT-01, DEFAULT)

When an AI agent generates image prompts (for `ima2 gen`, `ima2 multimode`,
`ima2 edit`, `ima2 video`, or the `ima2 gen` fallback), the prompt must be
**exhaustively detailed**. Vague one-liners produce generic, unusable output.
Write every prompt as if you are briefing a senior photographer, illustrator,
or motion designer who cannot ask follow-up questions.

Image assets need very explicit long prompts covering subject, composition,
palette, lighting, style or medium, materials, aspect ratio, constraints, and
avoid-list. When motion is wanted, use `ima2 video` rather than simulating
richness with static CSS washes. Prefer real photographic, generated bitmap,
texture, illustration, or video assets over CSS gradient backgrounds; gradients
remain scarce semantic devices under `anti-slop.md` FE-GRADIENT-01.

### Required Spec Fields

Every agent-authored prompt MUST include all applicable fields below. Omit a
field only when it genuinely does not apply (e.g. no text in the image).

```text
Use case: <taxonomy slug from imagegen skill>
Asset type: <where the asset will be used: hero, OG image, card, avatar, icon, texture, etc.>
Primary request: <one clear sentence describing the desired image>
Scene/backdrop: <specific environment, not "nice background">
Subject: <main subject with identifying details — material, color, shape, posture, expression>
Style/medium: <exact style: editorial photography, flat illustration, 3D render, watercolor, etc.>
Composition/framing: <camera angle, crop, subject placement, negative space intent>
Lighting/mood: <light source, direction, color temperature, mood, time of day>
Color palette: <specific colors or named palette — not "modern colors">
Materials/textures: <surface details: matte plastic, brushed steel, linen, weathered wood, etc.>
Text (verbatim): "<exact text to render>" with font style, size, placement
Dimensions: <target pixel dimensions and aspect ratio>
Constraints: <must-keep invariants>
Avoid: <explicit negative constraints>
```

### Specificity Rules

| Bad (vague) | Good (specific) |
|---|---|
| "a nice hero image" | "wide landscape product shot of a matte black thermos on a wet granite countertop, soft morning window light from the left, shallow depth of field, warm neutral tones, negative space on the right for headline overlay" |
| "modern background" | "soft radial gradient from #f8f9fa center to #e9ecef edges, subtle paper grain texture at 3% opacity, no objects, no patterns" |
| "Korean food photo" | "overhead flat-lay of budae-jjigae in a black stone pot, surrounded by small banchan dishes on a dark wood table, steam visible, warm tungsten lighting, editorial food photography style" |
| "logo on white" | "centered geometric mark: two interlocking triangles forming a hexagonal negative space, flat #1a1a2e on #ffffff, no gradients, strong silhouette at 32px, generous padding" |
| "a dashboard screenshot" | "realistic SaaS dashboard UI: top nav with avatar, left sidebar with 6 nav items, main area showing a line chart (3 series, 12 months) and a 4-column data table with 8 rows, light theme, Inter font, compact density" |

### Quality and Size Selection

| Asset Purpose | Quality | Size |
|---|---|---|
| Quick draft / iteration | `low` | `1024x1024` |
| Final hero / product shot | `high` | `1536x1024` (landscape) or target aspect |
| OG / social card | `high` | `1200x630` (round to nearest 16px multiple) |
| Mobile hero | `high` | `1024x1536` (portrait) |
| Print / 4K | `high` | `3840x2160` or `2160x3840` |
| Texture / tile | `medium` | `1024x1024` |
| Icon / avatar | `medium` | `512x512` or `256x256` |

### Multi-Candidate Strategy

For important visual assets (hero images, key illustrations), generate multiple
candidates and select the best:

```bash
# Generate 4 candidates in one request
ima2 gen "<detailed prompt>" --model oauth/luna -n 4 -d ./candidates --quality high

# Or use multimode for structurally different directions
ima2 multimode "<detailed prompt>" --max-images 4 -d ./candidates
```

After generation, inspect every candidate with `view_image` before selecting.
Do not blindly use the first result.

### Parallel Generation Patterns (FE-ASSET-PARALLEL-01, DEFAULT)

ima2 supports three parallel generation strategies. Choose by intent:

| Strategy | Command | When to Use | Server Behavior |
|----------|---------|-------------|-----------------|
| **Single-request batch** | `ima2 gen "<prompt>" --model oauth/luna -n 4 -d ./out` | Same prompt, want quick variations | One request, server returns N images |
| **Multimode** | `ima2 multimode "<prompt>" --max-images 4` | Same prompt, want structurally different directions | SSE streaming, slot-by-slot progress, each slot is an independent generation |
| **Independent CLI parallel** | Multiple `ima2 gen` in background | Different prompts, or mixed providers/models | Each is a separate server request, fully independent |

**Single-request batch** is fastest for same-prompt variations. **Multimode**
is better when you want to see each candidate arrive and potentially cancel
early. **Independent CLI parallel** is for concept exploration with different
prompts or provider/model mixes.

#### Independent CLI Parallel Recipe

```bash
# Launch 3 different prompts concurrently
ima2 gen "editorial hero with serif headline" --model oauth/luna --quality high -o ./out/editorial.png &
ima2 gen "product-led hero with device mockup" --model oauth/luna --quality high -o ./out/product.png &
ima2 gen "abstract gradient hero with floating shapes" --model oauth/luna --quality high -o ./out/abstract.png &

# Monitor active jobs
ima2 ps --json

# Cancel a job if a better candidate arrives first
ima2 cancel <requestId>

# Wait for all to finish
wait
```

#### Monitoring and Cancellation

For long-running generation (high quality, large size, video), monitor with:

```bash
# List active jobs with phase and elapsed time
ima2 ps --json

# Output: requestId, kind, phase, startedAt, prompt (truncated)
# Cancel a stuck or unwanted job
ima2 cancel <requestId>
```

#### Capacity Guard

The ima2 server enforces a concurrent job limit (default: 24). When exceeded,
requests return `TOO_MANY_JOBS` (HTTP 429) with `Retry-After: 5`. Agent
pattern: check `ima2 ps --json` before launching a batch; if active job count
is near the limit, wait or cancel low-priority jobs first.

#### `ima2 gen` Fallback

Before CLI generation, run `ima2 models --kind image` and configure
`ima2 defaults set image <lane>/<model>` or pass `--model <lane>/<model>` on
every call. When ima2 is unavailable, the native image-generation fallback
generates one image per call.
For parallel exploration, generate sequentially and inspect each before the
next. Multimode and independent CLI parallel have no `ima2 gen` equivalent;
degrade to single-image iteration with prompt refinement between rounds.

### Variant Selection Workflow (FE-ASSET-SELECT-01, DEFAULT)

After generating multiple candidates (via `-n`, multimode, or independent
parallel), select using a two-stage process:

**Stage 1 — Exploration (broad):** Generate 3-5 candidates with different
directions. Inspect all with `view_image`. Do not select yet.

**Stage 2 — Synthesis (not winner-picking):** Do NOT pick one winner. Build
an element ledger — for each design token (palette, composition, type
treatment, hero visual, stat row, section rhythm), note WHICH candidate did
it best and WHY. The final direction is assembled from the best elements
across all candidates. This mirrors `ima2-uiux` UX-CONCEPT-GEN-01 step 3.

#### Selection Scorecard

Rate each candidate on these axes before synthesizing:

| Axis | What to Check |
|------|---------------|
| Subject fidelity | Does the main subject match the brief? |
| Composition | Framing, negative space, visual weight balance |
| Palette | Color harmony, brand alignment, contrast |
| Text render | Korean/English text legibility (if applicable) |
| Asset-type fit | Right dimensions, crop safety, overlay space |
| Technical quality | No artifacts, correct lighting, clean edges |

#### `ima2 gen` Fallback

With `ima2 gen`, generate 1-2 candidates, inspect with `view_image`, refine
the prompt based on what is wrong, and iterate. The synthesis step still
applies when comparing across iteration rounds.

### Provider Routing (FE-ASSET-PROVIDER-01, DEFAULT)

When ima2 is available with multiple providers configured, choose by asset type:

| Asset Type | Recommended Provider | Why |
|-----------|---------------------|-----|
| Product hero, editorial, UI mockup | GPT OAuth (`--provider oauth`) | Best composition, text rendering, style control |
| Trending/cultural reference needed | Grok (`--provider grok`) | Mandatory web search grounds the generation |
| Budget draft, quick iteration | Gemini (`--provider gemini-api`) | Cheapest per-image cost |
| High-fidelity product photo | GPT OAuth + `--quality high` | Best detail, lighting, material rendering |
| Korean text in image | GPT OAuth + `--mode direct` | Best Hangul rendering with exact-text prompts |

Override per-request only: `ima2 gen "prompt" --model grok/grok-imagine-image-2.0`

#### `ima2 gen` Fallback

The `ima2 gen` tool uses a single provider (the Codex-native image generation
path). No provider routing is needed; quality and style are controlled through
prompt detail and the `quality` parameter alone.

### Reference Image Workflow

When a design reference, brand guide, or existing asset exists, always attach it:

```bash
# Style reference
ima2 gen "<prompt>" --model oauth/luna --ref style-guide.png --quality high

# Multiple references (composition + style)
ima2 gen "<prompt>" --model oauth/luna --ref layout-ref.png --ref brand-colors.png --quality high
```

Label each reference's role in the prompt text: "Use Image 1 as composition
reference. Use Image 2 as color/style reference."

### Korean Text in Images

When generating images with Korean text:
- Write the exact Korean string in quotes: `"오늘의 추천"`, not "some Korean text"
- Specify font style: `고딕체 (Gothic/Sans)` or `명조체 (Myeongjo/Serif)`
- Specify placement and approximate size relative to the canvas
- For mixed Korean + English, specify which script appears where
- Verify rendered text after generation — garbled Hangul is common and must be caught

### Asset Background Strategy (FE-ASSET-BG-01, DEFAULT)

GPT Image 2 CAN produce true transparent (alpha) backgrounds. For cutout
assets, reach for `--bg transparent` FIRST:

```bash
ima2 gen "3D render of a liquid chrome splash blob, organic starburst shape, \
  mirror-polished surface with iridescent cyan and gold reflections." \
  --bg transparent --model oauth/luna --quality high --mode direct -o chrome-splash.png
```

The flag sends the real API background parameter plus a tuned cutout suffix,
and the asset is saved as PNG (JPEG is refused — it cannot carry alpha).
Verified 2026-08-21 on the live OAuth path: 5/5 generations returned RGBA with
corners at alpha 0 and 42-56% fully transparent pixels, preserving PARTIAL
alpha on glass and foliage. Always confirm with `sharp(file).metadata()`
(`channels: 4, hasAlpha: true`) rather than trusting a preview.

**Still use the solid-background-then-remove strategy when** you specifically
need a matte (chroma-key video pipelines, compositing tools that expect green
screen), or when one generation refuses to isolate its subject cleanly:

**Generation: pure solid background.**

For cutout assets (icons, product shots, 3D objects, illustrations, logos,
stickers, UI elements that must float over arbitrary backgrounds):

```bash
# Pure black background — best for light/reflective subjects (chrome, glass, metal)
ima2 gen "3D render of a liquid chrome splash blob, organic starburst shape, \
  mirror-polished surface with iridescent cyan and gold reflections. \
  Floating on a PURE SOLID BLACK background. The background must be 100% flat \
  pure black hex #000000. No checkerboard, no transparency pattern, no gradient, \
  no floor plane, no shadow, no vignette, no ambient glow on the background." \
  --model oauth/luna --quality high --size 1024x1024 --mode direct -o chrome-splash.png

# Pure white background — best for dark/opaque subjects (products, dark UI elements)
ima2 gen "Clean product photo of a matte black wireless earbud, centered, \
  floating at slight angle. PURE SOLID WHITE background hex #ffffff. \
  No shadow, no gradient, no surface, no reflection plane." \
  --model oauth/luna --quality high --size 1024x1024 --mode direct -o earbud-cutout.png

# Solid brand color background — when the target surface color is known
ima2 gen "Flat illustration of a coffee cup with steam, centered. \
  PURE SOLID background hex #f5f0eb (exact match required). \
  No gradient, no texture, no shadow." \
  --model oauth/luna --quality medium --size 512x512 --mode direct -o coffee-icon.png
```

**Background prompt rules:**
- State the exact hex code and repeat the constraint: "PURE SOLID [color] background hex #XXXXXX"
- Explicitly ban common AI additions: "No checkerboard, no transparency pattern, no gradient, no floor plane, no shadow, no vignette, no ambient glow"
- Use `--mode direct` to prevent server-side prompt rewriting that might soften the constraint
- Black works best for reflective/metallic/glass subjects; white for dark/matte subjects
- Match the target page background color when the destination is known

**Post-processing: background removal.**

| Method | When to Use | How |
|--------|-------------|-----|
| **CSS `mix-blend-mode`** | Black bg → light page | `mix-blend-mode: screen` makes black transparent, keeps light content |
| **CSS `mix-blend-mode`** | White bg → dark page | `mix-blend-mode: multiply` makes white transparent, keeps dark content |
| **ima2 Canvas Mode** | Interactive cleanup | Open in Canvas Mode → background cleanup → export with alpha or matte |
| **Programmatic removal** | Build pipeline | `sharp` / ImageMagick / rembg for batch processing |
| **ima2 edit** | Targeted fix | `ima2 edit asset.png --prompt "remove the background completely, keep only the [subject]"` |

**CSS blend-mode recipe (zero post-processing):**

```css
/* Black background asset on a light page */
.chrome-asset {
  mix-blend-mode: screen;  /* black → transparent, light content preserved */
}

/* White background asset on a dark page */
.product-asset {
  mix-blend-mode: multiply;  /* white → transparent, dark content preserved */
}

/* For arbitrary backgrounds, layer with isolation */
.asset-container {
  isolation: isolate;  /* prevent blend from leaking to parent */
}
```

**`ima2 gen` fallback:** same solid-background prompting strategy applies.
No Canvas Mode available; use CSS blend modes or programmatic removal only.

**Anti-pattern:** hand-writing "transparent background" or "PNG with alpha
channel" into a prompt WITHOUT `--bg transparent`. Bare wording can still bake
a fake checkerboard into an opaque image; the flag pairs the API parameter with
the tuned suffix. Verify the alpha channel instead of eyeballing the preview.

### Prompt Iteration

- Start with one high-detail prompt. Inspect the result with `view_image`.
- On the next iteration, make ONE targeted change and re-specify all constraints.
  Do not rewrite the entire prompt from scratch.
- Repeat invariants every iteration to prevent drift.
- If the model consistently fails on a detail, try rephrasing or breaking the
  request into a base generation + edit pass.

### Frontend Asset Quick Recipes

**Hero image (landing page):**
```bash
ima2 gen "Use case: product-mockup. Asset type: landing page hero. A premium wireless headphone floating at a slight angle against a soft warm-gray studio backdrop. Matte black finish with brushed aluminum accents. Soft three-point studio lighting, key light from upper-left. Shallow depth of field. Wide composition with generous negative space on the right for headline overlay. No text, no logos, no watermark." \
  --model oauth/luna --quality high --size 1536x1024 -o hero.png
```

**OG / social share image:**
```bash
ima2 gen "Use case: ads-marketing. Asset type: social share card. Clean product flat-lay of a notebook, pen, and ceramic mug on a white marble desk. Overhead shot. Soft diffused daylight. Space in the upper third for title overlay. Warm neutral palette. No text, no logos, no watermark." \
  --model oauth/luna --quality high --size 1200x640 -o og-image.png
```

**App screenshot mockup background:**
```bash
ima2 gen "Use case: stylized-concept. Asset type: hero background for device mockup. Soft abstract gradient from #f0f4f8 to #dbeafe with subtle geometric shapes at 5% opacity. Clean, modern, minimal. No objects, no patterns, no text." \
  --model oauth/luna --quality medium --size 1920x1088 -o mockup-bg.png
```

**Avatar / profile placeholder:**
```bash
ima2 gen "Use case: stylized-concept. Asset type: user avatar. Friendly stylized portrait of a young professional, neutral expression, looking slightly left. Flat illustration style with subtle shadows. Solid #e5e7eb background. Circular crop safe. No text." \
  --model oauth/luna --quality medium --size 512x512 -o avatar.png
```
