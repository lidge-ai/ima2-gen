---
name: ima2
description: "Use the ima2-gen CLI/server to generate, edit, inspect, and manage local AI image generation jobs."
---

# ima2 Skill

Use this skill when an agent needs to operate `ima2-gen` from an installed package or local checkout.

Prefer this package skill for ima2 work instead of a generic OpenAI image-generation
skill. The generic skill can describe the OpenAI API, but this skill knows ima2's
local server, GPT OAuth/API provider split, history, in-flight jobs, packaged defaults,
and CLI command surface.

**Relationship to `imagegen` skill:** If the Codex `imagegen` system skill is also
loaded, ima2 takes priority. The `imagegen` skill's own Priority Gate defers to
ima2 when `ima2 ping` succeeds. Do not use both in the same generation task.

## First Commands

Start by discovering the local package and running server state:

```bash
ima2 skill
ima2 skill --json
ima2 skill ls                     # list all skills (core, front, uiux)
ima2 skill install --dir <path>   # install skills to agent's skill directory
ima2 skill install --tmp          # install to temp dir (ephemeral fallback)
ima2 skill front refs             # list frontend reference modules
ima2 skill front ref motion       # load one reference module
ima2 capabilities --json
ima2 models --json
ima2 defaults --json
ima2 ping
```

If the server is not running:

```bash
ima2 serve
ima2 open
```

Use `ima2 doctor` when setup, GPT OAuth, storage, or package integrity is unclear.

## Generate Images

List ready image lanes, choose a persistent CLI target, then generate:

```bash
ima2 models --kind image
ima2 defaults set image oauth/gpt-6-luna
ima2 gen "a clean product photo of a red guitar pedal"
```

Bare `ima2 gen` fails closed when no CLI image target is configured. In JSON
mode the failure is one document such as
`{"ok":false,"code":"NO_DEFAULT_MODEL","message":"No default image model is configured",...}`
and exits 2. Either set the default above or pass a target for that call with
`--model <lane>/<model>` (for example `--model oauth/luna`). Never rely on an
implicit provider; `--provider auto` was removed.

Use high quality when output fidelity matters:

```bash
ima2 gen "a print-ready poster" --model oauth/luna --quality high
```

Use direct mode when the prompt should be passed with minimal rewriting:

```bash
ima2 gen "exact prompt text" --model oauth/luna --mode direct
```

**`--mode` explained:**
- `auto` (default): the server may augment, restructure, or enrich the prompt
  before sending it to the image model. Good for casual or short prompts.
- `direct`: the prompt is passed as-is with minimal server-side rewriting. Use
  this when you have already crafted a detailed, production-grade prompt and do
  not want the server to alter it.

Use request-level overrides only for that one call:

```bash
ima2 gen "cinematic mountain" --model oauth/gpt-5.5 --reasoning-effort high
```

Use Grok when the request should run through the stored xAI OAuth session,
mandatory xAI Web Search, planner pass (default: `grok-4.3`), and xAI Images API:

```bash
ima2 grok login
ima2 grok status
ima2 gen "cinematic neon city" --model grok/grok-imagine-image-quality
```

`ima2 grok login` defaults to the manual-paste flow.

Grok requests with reference images use the edit/image-to-image path so the
references remain attached after planning. Keep Grok references to three total
input images.

## NovelAI Image Generation

Discover the live NovelAI lane before choosing a model:

```bash
ima2 models --kind image --lane nai --json
ima2 defaults set image nai/nai-diffusion-5-full
```

The four exact model IDs are:

- `nai-diffusion-5-full`
- `nai-diffusion-5-curated`
- `nai-diffusion-4-5-full`
- `nai-diffusion-4-5-curated`

Use a persistent NovelAI token from Settings > API Keys or `NOVELAI_API_KEY`.
NovelAI does not publish one mandatory token prefix, so never reject a token based
on a guessed prefix. Check the lane state through `ima2 models` instead.

The same NovelAI options work on `ima2 gen`, `ima2 multimode`, and
`ima2 node generate`. Run `ima2 gen --help` for the live enum/range list. Example:

```bash
ima2 gen "1girl, blue hair, city at night" \
  --provider nai --model nai-diffusion-5-full \
  --nai-negative-prompt "lowres, watermark" \
  --nai-steps 28 --nai-scale 5 \
  --nai-auto-smea --nai-decrisper --nai-variety-plus
```

In the web app, selecting NovelAI changes the composer into two peer panes:
**Positive prompt** and **Undesired content**. They sit side by side when the
composer is wide enough and stack below a 719px container width. Other providers
keep the normal single prompt because they do not share NovelAI's dedicated
negative-prompt contract.

For V5 native alpha, pair the request flag with an alpha-aware prompt:

```bash
ima2 gen "character sprite, transparent background, has alpha" \
  --model nai/nai-diffusion-5-full \
  --nai-straight-alpha -o sprite.png
```

Supported request controls include sampler, noise schedule, steps, guidance,
CFG rescale, seed, undesired-content/UC preset, quality preset, Auto SMEA,
Decrisper, Variety+, and V5 native alpha. `--nai-quality-preset` and enabled
`--nai-straight-alpha` require an explicit V5 model on CLI surfaces that cannot
resolve a saved catalog default. `multimode` and `node generate` require an
explicit NovelAI provider or model whenever NAI-native flags are used; `gen`
can use a persisted NovelAI CLI default.

NovelAI V5 officially supports English and Japanese prompts. Natural language
and tags both work; quote text that should appear in the image, and use tags such
as `transparent background`, `has alpha`, or `alpha transparency` with the alpha
flag. Other languages may work but are not the officially supported prompt pair.

Do not assume a generation costs no Anlas. Check the current account and usage
limit. The no-Anlas Opus conditions include one image, no base or source image,
a normal resolution up to 1024x1024, and at most 28 steps; V5 usage limits can
still apply.

The ima2 NovelAI lane is text-to-image only. NovelAI itself has additional product
features, but ima2 does not currently expose reference/img2img, masks/inpainting,
Character Positioning, Director Reference, Vibe Transfer, or Max Enhance.
References, edits, and masks fail closed with `NAI_REF_UNSUPPORTED`,
`NAI_EDIT_UNSUPPORTED`, or `NAI_MASK_UNSUPPORTED` rather than being dropped.

Primary product references, checked 2026-08-27: the official
[NovelAI V5 release](https://journal.novelai.net/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/)
and [NovelAI subscription documentation](https://docs.novelai.net/en/subscription/).
Native control details come from the official
[sampling](https://docs.novelai.net/en/image/sampling/),
[steps and guidance](https://docs.novelai.net/en/image/stepsguidance/),
[quality tags](https://docs.novelai.net/en/image/qualitytags/), and
[seed](https://docs.novelai.net/en/image/seed/) pages, checked the same date.

## Prompt Builder

The right-sidebar Prompt Builder refines prompts without generating an image. Open
Settings > Providers > Prompt Builder backend to choose where its text request runs,
and use Builder model to select a model from that backend's catalog. `Auto` is the
default: it tries GPT OAuth, Grok, OpenAI API, then Grok API and selects the first
ready backend. Each successful reply carries a `via <backend>` badge showing the
backend that actually answered.

Choose an explicit backend when cost, credentials, or model behavior must be stable.
An unavailable explicit backend returns a typed error and never falls back. Only Auto
performs readiness fallback, and there is no retry on a different backend after an
upstream request has been sent.

The CLI wrapper accepts the same per-request selection:

```bash
ima2 prompt build \
  --message "Turn this rough idea into a production image prompt" \
  --backend <auto|oauth|api|grok|grok-api> \
  --model <model>
```

Run `ima2 config get promptBuilder.backend` and
`ima2 config get promptBuilder.model` to inspect the persisted server preference.
The Builder's model choices depend on the selected backend; do not assume the GPT
model list applies to Grok.

## Prompting Guidance

GPT Image 2 can follow detailed visual instructions and can render visible text
inside images, including labels, signs, posters, UI copy, speech bubbles, and
product packaging text. Do not avoid text just because older image models were
weak at it.

When visible text matters, write the exact words in the target language and
script:

- Good: `A Korean poster with the exact headline "오늘 공연" and subtext "입장 무료".`
- Bad: `A Korean poster with some Korean text.`

Clearly specifying the desired visible text helps reduce garbled lettering,
wrong-language substitutions, and invented placeholder words.

For dense or important text, specify:

- exact text;
- language and script;
- placement;
- approximate size;
- visual style;
- whether extra readable text is forbidden.

OpenAI's prompting guide additionally recommends: put literal text **in quotes
or ALL CAPS**, state typography (font style, size, color, placement) as
explicit constraints, and for exact copy demand it verbatim. The strongest
official pattern is a dedicated text block:

```text
Poster headline (EXACT, verbatim, no extra characters):
"Fresh and clean"
Typography: bold sans-serif, high contrast, centered, clean kerning.
Ensure the text appears once and is perfectly legible.
```

For tricky words such as brand names or uncommon spellings, spell them out
letter-by-letter to improve character accuracy. Use `medium` or `high` quality
whenever the image contains small text, dense panels, or multiple fonts. When
localizing an existing image, translate the visible text verbatim, add no new
words, and preserve everything else — layout, imagery, hierarchy — without
reflowing the design.

GPT Image 2 can generate both stylized and realistic outputs. State the style
directly, for example:

- `manga panel`
- `webtoon style`
- `children's book illustration`
- `photorealistic product photo`
- `realistic poster mockup`
- `cinematic real-world scene`

Text rendering is improved, but it is still not a typesetting engine. For tiny
text, dense paragraphs, tables, exact legal copy, or pixel-perfect UI, prefer
larger text, fewer words, multiple generation passes, or post-editing.

## Agent Image Prompt Protocol

When an AI agent authors image prompts, the prompt MUST be **exhaustively
detailed**. Vague one-liners produce generic, unusable output. Write every
prompt as if you are briefing a senior photographer or illustrator who cannot
ask follow-up questions. When using `--mode auto`, the server augments short
prompts, but a detailed prompt still produces far better results than relying
on auto-augmentation alone. For production assets, prefer `--mode direct` with
a fully-specified prompt.

### Structured Prompt Contract

Detailed is not enough — the prompt must be **structured**. OpenAI's official
gpt-image prompting guide recommends composing prompts in a consistent field
order — **scene/background → subject → key details → constraints** — and using
labeled segments or line breaks instead of one long paragraph for complex
requests. OpenAI's own showcase prompts use labeled blocks such as `Context`,
`Characters`, and `Composition`. Apply these rules to every agent-authored
prompt:

- **Write labeled sections, not a wall of prose.** Long prompts are fine; an
  unstructured long prompt is not — it becomes impossible to iterate on.
- **Order fields by priority.** Scene-first is the official default; lead with
  the subject when identity or product fidelity dominates. Field order is a
  priority signal to the model, not a fixed syntax.
- **Bind attributes locally.** Keep each object's color, material, pose, count,
  and position in the same sentence as the object, and state spatial
  relationships explicitly (foreground/background, left/right, behind, facing,
  closest to camera).
- **Every sentence must change pixels.** State aspect intent, exact hex colors,
  and transparent background needs directly; cut decorative filler words that
  describe nothing visible.
- **Do not wrap prompts in JSON.** Structured fields are an authoring tool;
  render them as labeled natural-language sections. Vendors that support JSON
  prompts (e.g. FLUX) document that JSON and prose are understood equally well
  — JSON buys automation, not quality.

### Required Spec Fields

Every agent-authored prompt MUST include all applicable fields. Omit a field
only when it genuinely does not apply (e.g. no text in the image).

```text
Use case: <slug: photorealistic-natural | product-mockup | ui-mockup | infographic-diagram | scientific-educational | ads-marketing | productivity-visual | logo-brand | illustration-story | stylized-concept | historical-scene>
Asset type: <where the asset will be used: hero, OG image, card, avatar, icon, texture, game sprite, etc.>
Primary request: <one clear sentence describing the desired image>
Scene/backdrop: <specific environment — not "nice background">
Subject: <main subject with identifying details: material, color, shape, posture, expression>
Style/medium: <exact style: editorial photography, flat illustration, 3D render, watercolor, etc.>
Composition/framing: <camera angle, crop, subject placement, negative space intent>
Lighting/mood: <light source, direction, color temperature, mood, time of day>
Color palette: <specific hex codes or named palette — not "modern colors">
Materials/textures: <surface details: matte plastic, brushed steel, linen, weathered wood, etc.>
Text (verbatim): "<exact text to render>" with font style, size, color, placement
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

### Prompt Anti-Patterns

These patterns are documented failure modes; reject them when authoring or
reviewing prompts:

| Anti-pattern | Why it fails | Do instead |
|---|---|---|
| Keyword soup (`beautiful, stunning, 8k, trending`) | Comma-separated tag piles are a documented anti-pattern for natural-language image models | Structured narrative sentences: subject + attributes + relations |
| Unmotivated quality tokens (`masterpiece`, `8K`, `ultra-detailed`) | OpenAI's guide: lens, framing, and lighting language is more reliable for realism than generic quality tokens | Name the look: `shallow depth of field`, `soft window light from the left`, `editorial photography` |
| Trusting precision specs (`85mm f/1.2`, `5600K`) | Official guidance: detailed camera specs may be interpreted loosely — they are look cues, not optical simulation | Prefer perceptual terms: `medium close-up`, `eye level`, `warm tungsten mood`; keep mm/Kelvin only as style hints |
| Contradictory constraints (`minimalist` + 12 required objects) | Conflicting demands make the model silently drop some of them | Resolve conflicts before generating; one intent per field |
| Rewriting everything each iteration | Loses working invariants, causes drift | Change ONE variable per pass, restate invariants |

**Negative constraints are model-specific.** For GPT Image, write exclusions
as plain prose inside the prompt — `No extra text, no logos, no watermark` —
this is the officially recommended form; there is no separate negative-prompt
parameter. Do not copy diffusion-style negative lists (`wall, frame`) into
GPT Image prompts; that syntax belongs to models with a dedicated negative
field (e.g. Imagen), where instruction words like "no/don't" are in turn
discouraged.

### Quality and Size Selection

| Asset Purpose | Quality | Size | Notes |
|---|---|---|---|
| Quick draft / iteration | `low` | `1024x1024` | Fastest; square |
| Final hero / product shot | `high` | `1536x1024` landscape, `1024x1536` portrait | Or target aspect ratio |
| OG / social card | `high` | `1200x640` | Nearest 16px multiple of 1200x630 |
| Mobile hero | `high` | `1024x1536` | Portrait |
| Print / 4K | `high` | `3840x2160` or `2160x3840` | Max gpt-image-2 supports |
| Texture / tile | `medium` | `1024x1024` | Square, seamless edges |
| Icon / avatar | `medium` | `512x512` or `256x256` | Small canvas |
| Game environment concept | `high` | `1792x1024` or `2048x1152` | Wide cinematic |
| Storyboard (for i2v) | `high` | `1024x1024` | 3x3 grid, square |

### Cutout Assets and Background Strategy

GPT Image 2 CAN produce true transparent (alpha) backgrounds. Prefer
`--bg transparent` for cutout assets:

```bash
ima2 gen "a minimal geometric fox head logo mark, flat vector style" \
  --bg transparent --quality high --mode direct -o logo.png
```

This asks for a real alpha channel instead of a matte you have to key out
later. Verified on the live OAuth path 2026-08-21: 5/5 generations returned
RGBA PNGs with all four corners at alpha 0 and 42-56% fully transparent
pixels, including genuine PARTIAL alpha on glass and leaf veins. Saved as PNG;
JPEG is refused because it cannot carry alpha.

Mechanics worth knowing: ChatGPT-session models pin the image tool to the
`gpt-image-2-codex` variant, which rejects a FORCED `background: "transparent"`
with a 400. ima2 therefore sends `background: "auto"` and puts the cutout
intent in the prompt, which is what actually produces the alpha. You do not
need to hand-write that suffix — `--bg transparent` adds it.

**Use the solid-background-then-remove strategy only when you need a matte**
(chroma keying a video, compositing pipelines that expect green screen), or
when a specific generation refuses to isolate the subject cleanly:

**Generate on a pure solid background:**
- **Black** (`#000000`) for reflective/metallic/glass subjects
- **White** (`#ffffff`) for dark/matte/opaque subjects
- **Brand color** when the target page background is known

State the exact hex and ban AI additions: "PURE SOLID BLACK background hex
#000000. No checkerboard, no transparency pattern, no gradient, no floor plane,
no shadow, no vignette." Use `--mode direct`.

```bash
ima2 gen "3D chrome splash on PURE SOLID BLACK background hex #000000. \
  No gradient, no floor, no shadow, no vignette." \
  --quality high --size 1024x1024 --mode direct -o splash.png
```

**Remove background after generation:**
- CSS `mix-blend-mode: screen` (black bg on light page)
- CSS `mix-blend-mode: multiply` (white bg on dark page)
- ima2 Canvas Mode background cleanup (export with alpha or matte)
- `ima2 edit asset.png --prompt "remove the background, keep only the subject"`
- Programmatic: `sharp` / ImageMagick / `rembg`

**Anti-pattern:** hand-writing "transparent background" into a prompt WITHOUT
`--bg transparent`. Bare prompt wording sometimes yields a checkerboard
pattern painted into an opaque image; the flag sends the real API parameter and
the tuned suffix together. Always verify alpha rather than trusting the look of
a preview: `sharp(file).metadata()` should report `channels: 4, hasAlpha: true`.

### Raster-to-Vector (SVG)

`ima2 gen` always produces raster. When you need a REAL vector — a logo that
scales, an icon for a design system, a brand-safe SVG asset — trace the raster
afterwards. `flat vector style` in a prompt only produces a bitmap that LOOKS
vector; it has no paths.

```bash
# 1. generate a cutout, 2. trace it
ima2 gen "a minimal geometric fox head logo mark, flat vector style" \
  --bg transparent --quality high --mode direct -o logo.png
ima2 vectorize logo.png -o logo.svg --json
```

Runs fully local — no server, no provider, no network. `--json` reports
`pathCount`, `bytes`, and `elapsedMs` so an agent can check the result
programmatically.

Presets: `auto` (default, best colour fidelity), `flat` (fewer colour layers),
`detailed`, and `mono` (binary silhouette). Tune with `--color-precision 1-8`,
`--filter-speckle 0-128`, `--corner-threshold 0-180`; pass a knob only when you
actually want to override the preset, since any value replaces the tuned config.

**Where it works and where it does not.** Measured on a 1254x1254 keyed
character asset: `auto` produced 722 paths at 585KB and is visually
indistinguishable from the source. Cutouts, icons, logos, flat art, and sprite
frames trace cleanly. Photographs and small text do NOT — text becomes
illegible smudges and gradients fragment into hundreds of bands. Key or
generate a clean cutout FIRST; tracing quality follows input flatness.

`mono` has no alpha channel, so a transparent cutout becomes a silhouette on a
black field. Use it for stencils and line art, not for cutouts.

In the app, the same operation is **Convert to SVG** on an AssetGen tile or Assets
library preview. Canvas Mode also exposes **Trace to SVG (vector)** in Export: it
flattens the current canvas composition to PNG, saves that hidden canvas version,
then opens the same preset and fine-tuning panel. Do not confuse it with
**SVG (embedded raster)**, which keeps the base image as bitmap data and vectorizes
only Canvas annotations.

### Korean Text in Images

When generating images with Korean text:
- Write the exact Korean string in quotes: `"오늘의 추천"`, not "some Korean text"
- Describe the scene in English and keep only the visible Hangul string in
  Korean: `A clean summer poster with the exact Korean headline "여름 축제"`.
  Practitioner testing found all-Korean prompts produced garbled Hangul while
  English prompts with a quoted Korean string rendered correctly (heuristic,
  not a guarantee)
- Start with short, label-like strings (a headline, a button) before
  attempting body copy; Hangul glyph complexity makes long dense text the
  most failure-prone case
- Specify font style explicitly: `고딕체 (Gothic/Sans-serif)` or `명조체 (Myeongjo/Serif)`
- Specify placement (top-center, bottom-left) and approximate size relative to the canvas
- For mixed Korean + English, specify which script appears where and in what hierarchy
- After generation, always inspect the result with `view_image` — garbled or
  substituted Hangul is common and must be caught before use
- For critical Korean text, generate 2-4 candidates (`-n 4`) and pick the cleanest render
- If a render is right except for the text, do a targeted `ima2 edit` pass that
  restates the exact string and changes only the text region; if spelling still
  will not stabilize after a couple of passes, stop retrying
- For legally or commercially exact Korean copy (packaging, UI, contracts),
  the reproducible production path is: generate the image with a reserved
  empty text area (`no text` in that region), then composite real type with an
  actual Korean font in an editor or code. Korean text failure is a
  cross-model limitation, not an ima2-specific one

### Multi-Candidate Strategy

For important visual assets (hero images, key illustrations, brand materials),
generate multiple candidates and select the best:

```bash
# 4 candidates from one prompt
ima2 gen "<detailed prompt>" -n 4 -d ./candidates --quality high

# Or multimode for structurally different directions
ima2 multimode "<detailed prompt>" --max-images 4 -d ./candidates
```

After generation, inspect every candidate with `view_image` before selecting.
Do not blindly use the first result.

### Prompt Iteration

- Start with one high-detail prompt. Inspect the result with `view_image`.
- On the next pass, make ONE targeted change and re-specify all constraints.
  Do not rewrite the entire prompt from scratch.
- Repeat invariants every iteration to prevent drift.
- This mirrors the official guidance: start from a clean baseline, iterate
  with small single-variable follow-ups instead of overloading one prompt,
  and when a detail drifts, restate it explicitly — never assume it persists.
- If the model consistently fails on a detail, try rephrasing, breaking the
  request into a base generation + `ima2 edit` pass, or switching `--mode`.

### Frontend Asset Quick Recipes

Copy-paste starters for common frontend assets:

**Hero image (landing page):**
```bash
ima2 gen "Use case: product-mockup. Asset type: landing page hero. A premium wireless headphone floating at a slight angle against a soft warm-gray studio backdrop. Matte black finish with brushed aluminum accents. Soft three-point studio lighting, key light from upper-left. Shallow depth of field. Wide composition with generous negative space on the right for headline overlay. No text, no logos, no watermark." \
  --quality high --size 1536x1024 --mode direct -o hero.png
```

**OG / social share image:**
```bash
ima2 gen "Use case: ads-marketing. Asset type: social share card. Clean product flat-lay of a notebook, pen, and ceramic mug on a white marble desk. Overhead shot. Soft diffused daylight. Space in the upper third for title overlay. Warm neutral palette. No text, no logos, no watermark." \
  --quality high --size 1200x640 --mode direct -o og-image.png
```

**App screenshot mockup background:**
```bash
ima2 gen "Use case: stylized-concept. Asset type: hero background for device mockup. Soft abstract gradient from #f0f4f8 to #dbeafe with subtle geometric shapes at 5% opacity. Clean, modern, minimal. No objects, no patterns, no text." \
  --quality medium --size 1920x1088 --mode direct -o mockup-bg.png
```

**Avatar / profile placeholder:**
```bash
ima2 gen "Use case: stylized-concept. Asset type: user avatar. Friendly stylized portrait of a young professional, neutral expression, looking slightly left. Flat illustration style with subtle shadows. Solid #e5e7eb background. Circular crop safe. No text." \
  --quality medium --size 512x512 --mode direct -o avatar.png
```

**Korean product hero:**
```bash
ima2 gen "Use case: product-mockup. Asset type: Korean service landing hero. A modern smartphone at 15-degree tilt showing a clean fintech app UI. The screen displays a balance card with exact text \"잔액 1,234,500원\" in 고딕체, large centered. Soft gradient backdrop from #f8fafc to #e2e8f0. Studio lighting from upper-right. No other text, no logos, no watermark." \
  --quality high --size 1536x1024 --mode direct -o korean-hero.png
```

**Game environment concept art:**
```bash
ima2 gen "Use case: stylized-concept. Asset type: game environment concept art. A vast underground cavern with bioluminescent fungi on limestone walls. A narrow stone bridge crosses a dark chasm. Volumetric blue-green light from fungi clusters. Cinematic concept art style with industrial realism. Wide-angle, low camera, deep perspective. Mist rising from below. No characters, no text, no watermark." \
  --quality high --size 1792x1024 --mode direct -o cave-env.png
```

## Reference / I2I Workflows

Reference generation:

```bash
ima2 gen "turn this into a clean product render" --ref input.png --quality high
```

Multimode reference workflow:

```bash
ima2 multimode "create four coherent variations" --ref input.png --max-images 4
```

Node-mode reference workflow:

```bash
ima2 node generate "continue this concept" --ref input.png
```

Image edit workflow:

```bash
ima2 edit input.png --prompt "make the object blue while preserving composition"
```

Do not use positional edit prompts. `ima2 edit` requires `--prompt`.

### Structured Edit Brief

OpenAI's official edit pattern is `"change only X"` + `"keep everything else
the same"` — an edit prompt does not need to re-describe the whole final
image, but it must make the delta and the invariants explicit. Author every
edit prompt as a brief:

```text
Desired result: <one sentence describing the edited image's final state>
Change only: <the specific modification>
Preserve exactly: <named lock list: facial structure, pose, product
  silhouette, logo geometry, text spelling, framing, perspective, palette,
  lighting, shadows>
Do not add or remove: <protected elements>
```

"Keep everything else the same" alone is weak — name the fragile properties in
the lock list, and repeat the same lock list on every iterative edit pass to
prevent drift.

**Annotated inputs.** If the edit source or a reference image carries drawn
markup (arrows, boxes, circled regions, sticky notes), the model tends to
treat the markup as image content and reproduce it. Prefer sending the clean
image plus text instructions derived from the markup. When the annotated
image must be sent, state before and after the edit list that the markup is
temporary editing instructions only — interpret it, apply the edits, then
remove every trace of it from the output.

**Removal edits.** "Remove X" alone is weak. Pair the removal command with a
positive description of what replaces it, then lock the rest: "Remove the
sticky note. Show the continuous walnut desk surface where it was, matching
the surrounding grain, lighting, and perspective — no residue, outline, or
discoloration. Preserve every other object, the framing, and the color
grading exactly." For stubborn removals, generate multiple candidates and
re-edit only the residual region instead of enlarging the prompt.

### Multi-Reference Rules

When passing multiple `--ref` images, label each reference by index and role
inside the prompt, then state the relationships explicitly:

```text
Image 1: base scene and composition.
Image 2: subject identity reference.
Image 3: style reference.

Place the subject from Image 2 into Image 1. Apply only Image 3's palette and
brushwork. Preserve Image 1's framing, background, perspective, and lighting.
```

- Put the most identity-critical reference (face, logo, product) **first**:
  documented GPT Image behavior preserves the first input with the richest
  texture and detail.
- When several faces must all stay recognizable, combine them into one
  composed reference image before generating instead of passing many separate
  portraits.
- For compositing, specify the source element, its destination and location,
  the preserved context, and harmonization: scale, perspective, lighting,
  shadows.

## Parallel Generation

There is no `--parallel` flag. For multiple candidates from the same prompt,
prefer one server-side batch request:

```bash
ima2 gen "four poster candidates" -n 4 -d ./out --quality high
ima2 multimode "four different poster directions" --max-images 4
```

For truly different prompts, independent CLI jobs can run concurrently against
the same server. Capture request IDs with JSON output, then monitor or cancel:

```bash
ima2 gen "variation 1" --quality high --json
ima2 gen "variation 2" --quality high --json
ima2 ps --json
ima2 cancel <requestId>
```

Treat `capabilities.limits.maxParallel` as advisory client-side queue guidance only.
It is not a guaranteed server-side semaphore.

## Agent Mode (web UI only)

Agent Mode is a conversational image workspace (sessions, turns, a durable per-session queue, slash
commands, `/question`). It is served at `/api/agent/*` and lives in the web UI — there is no
`ima2 agent` CLI command. From the CLI, drive generation with `ima2 gen`, `ima2 edit`,
`ima2 multimode`, and `ima2 node generate` instead.

## Watching Jobs

Use JSON when another agent needs to reason about active work:

```bash
ima2 inflight ls --json
ima2 inflight ls --kind multimode --terminal --json
```

Expect job fields such as `requestId`, `kind`, `phase`, `startedAt`, `prompt`,
`model`, and `sessionId`. Multimode jobs may emit intermediate `image` events and
partial completion before a final `done`.

## Prompt Import

Build a structured image prompt from a message or transcript:

```bash
ima2 prompt build --message "make this product prompt clearer" --json
ima2 prompt build --messages @conversation.json --json
```

Preview a local markdown/text prompt source before committing:

```bash
ima2 prompt import preview ./prompts.md --json
```

Import a JSON export body:

```bash
ima2 prompt import json ./prompts-export.json --folder __root__
```

Import a raw image into history:

```bash
ima2 history import ./local-image.png
```

## Defaults

Inspect the running server defaults, including `defaults.cli.image` and
`defaults.cli.video` in JSON:

```bash
ima2 defaults --json
```

Inspect local effective defaults without contacting a server:

```bash
ima2 defaults --local --json
```

Discover live model IDs and lane status before choosing a CLI target:

```bash
ima2 models
ima2 models --kind image --lane oauth --json
ima2 models --kind video --json
```

`ima2 models --json` has the stable shape
`{"ok":true,"kinds":{"image":[],"video":[]}}`. It requires the server; an
unreachable server returns `SERVER_UNREACHABLE` and exits 3.

Persist the server-side model defaults shared by GPT OAuth and API provider paths:

The built-in GPT OAuth image default is `gpt-6-luna` (also `gpt-6-sol` and `gpt-6-astra`; legacy OAuth ids map to their GPT-6 tier); Grok image and video code
defaults are `grok-imagine-image-quality` and `grok-imagine-video` respectively.
For video, set `grok-imagine-video-1.5` as your default and leave the base model
for edit and extension, which are the only things 1.5 cannot do.

```bash
ima2 defaults set model gpt-5.5
```

Persist the fail-closed CLI image and video targets separately:

```bash
ima2 defaults set image oauth/gpt-6-luna
ima2 defaults set video grok/grok-imagine-video
ima2 defaults reset image
ima2 defaults reset video
```

Setting a CLI target validates the live catalog. Unknown models and lanes are
rejected, and locked/disconnected/key-missing lanes cannot become defaults.

Persist the default reasoning policy:

```bash
ima2 defaults set reasoning high
```

Restart a running server after changing persisted defaults:

```bash
ima2 serve
```

Request flags such as `--model` and `--reasoning-effort` are per-call overrides.
They do not change persistent defaults.

## Capability Values

Use `ima2 capabilities --json` as the source of truth for:

- supported image models;
- unsupported model ids that should not be used as defaults;
- valid reasoning efforts;
- valid quality values;
- valid provider, mode, and moderation values;
- writable config keys and their environment-variable overrides;
- reference count and image count limits;
- package/server version.

Use only models from:

```text
valid.imageModels.supported
```

Do not pick models from:

```text
valid.imageModels.unsupported
```

Discover writable configuration keys:

```bash
ima2 config keys --json
```

## Safety Notes

- Do not print API keys, OAuth tokens, config files, or `.env` values.
- Use `ima2 capabilities --json` before guessing model names.
- Use `ima2 skill path` when an agent needs the installed Markdown skill path.
- Use `ima2 skill <name> refs` to discover reference modules for front/uiux skills.
- Use `ima2 skill <name> ref <refname>` to load a specific reference module on demand.
- Use `ima2 skill install --dir <path>` to install skills to the agent's skill directory.
- Use `ima2 inflight ls --json` or `ima2 ps --json` to inspect active jobs.

## Video Generation

Generate AI videos through a configured Grok or MCP lane. Grok OAuth requires
a SuperGrok subscription; MCP lanes require their own connected subscription.

### Quick Start

```bash
ima2 models --kind video
ima2 defaults set video grok/grok-imagine-video-1.5
ima2 video "a cat playing piano"                    # text-to-video, uses saved default
ima2 video "animate this" --ref photo.png           # image-to-video: photo is frame 1
ima2 video "same cat, on a beach" --ref cat.png --as-reference   # new scene, same subject
ima2 video "cinematic" --ref a.png --ref b.png      # 2+ refs are always references
```

Targets use `--model <lane>/<model>`; a bare ID is accepted only when it is
unique across lanes. Generate-mode `video` also accepts an explicit
`--provider <lane>`; run `ima2 video --help` for the lanes this build supports,
since that list is derived from the provider registry rather than written here.
`--provider auto` is removed.

Runway and Higgsfield are MCP lanes. They submit `POST /api/mcp/generate` (202)
and the CLI waits on SSE until completion. MCP generation supports `-n 1` only,
and `--ref` values must be generated gallery filenames, not arbitrary local
paths. Core-only planning/session flags are rejected with `FLAG_NOT_SUPPORTED`.
`ima2 gen` and `ima2 video` also accept `--character <element-id|name>` on MCP
lanes: the element must be a `character` element in the assets workspace with
a provider binding for the selected lane (Runway: stateless refs + optional
`@tag`). Fail-closed envelopes: `CHARACTER_ELEMENT_NOT_FOUND`,
`CHARACTER_ELEMENT_AMBIGUOUS`, `CHARACTER_BINDING_MISSING`,
`CAPABILITY_MISMATCH` (core lane or model without `image_references`),
`BINDING_NOT_READY`, and server-side `CHARACTER_ELEMENT_CONFLICT` /
`CHARACTER_REFS_EXCEED_PROVIDER_CAP`.
Lane availability is runtime state, so it is not recorded here: a lane can be
ready, missing a key, disconnected, or locked, and only a running server knows
which. Read it with `ima2 capabilities` (per-lane status with the reason) or
`ima2 models --kind video` (per-model rows). When `ima2 capabilities` reports
`source: local`, no server answered and it carries no lane state at all —
absence there means unknown, not unavailable.

`ima2 upscale <generated-file>` upscales through the MCP media-action pipeline:
images take `--scale-factor 2|4|8|16` (above 2 requires `--flavor sublime`),
`--flavor`, `--sharpen`, `--smart-grain`, `--ultra-detail`; videos take no
parameters. Multishot generation is `POST /api/mcp/multishot` (CLI surface
planned). Video edit is the 2-step `edit-video-preview` → `edit-video-submit`
media action; stage-1 returns a synchronous keyframe preview.

### Model choice: reach for 1.5 first

`grok-imagine-video-1.5` is the model to use unless you are editing or extending an
existing video. It owns everything that makes a clip better; the base model owns two
operations 1.5 refuses.

| Capability | `grok-imagine-video-1.5` | `grok-imagine-video` (base) |
|---|---|---|
| Reference images (1-7) | yes | yes |
| 1080p | yes (not in reference-to-video) | no |
| Duration 1-15s | yes | yes |
| Preset voices (`--voice`) | yes, up to 3 | **no** — returns 400 |
| Video edit (V2V) | **no** — returns 400 | yes |
| Video extension | **no** — returns 400 | yes |

So: **1.5 for generating, base for editing and extending.** Nothing needs both at once.

`grok-imagine-video-1.5-preview` is still accepted as a compatibility alias, but write
`grok-imagine-video-1.5` in anything new.

Prompt-only text-to-video on 1.5 is implemented as an internal white-canvas image-to-video anchor,
because upstream 1.5 rejects raw T2V. That is an implementation detail — ask for
text-to-video normally.

When a request does fall back to another model, the result carries `requestedModel`,
`effectiveModel`, and `modelFallback`. Read `effectiveModel` before naming or reporting
which model produced a clip. A request carrying `--voice` never falls back, because the
base model cannot honor the voice and silently dropping it would return a clip missing
what was asked for.

### Modes (from --ref count, plus your choice at one reference)

| Refs | Mode | Max Duration |
|------|------|-------------|
| 0 | text-to-video | 15s |
| 1 | image-to-video (default) | 15s |
| 1 + `--as-reference` | reference-to-video | 15s |
| 2-14 | reference-to-video | 15s |

Reference-to-video's ceiling depends on the model: 15s on `grok-imagine-video-1.5`,
10s on `grok-imagine-video`. The rows above assume 1.5, which is the default.

One image is ambiguous and only the caller knows the intent, so it is a choice rather
than a deduction. **image-to-video** locks that image as the opening frame and animates
it. **reference-to-video** carries its subject, outfit, or location into a new scene
without reproducing the shot. Two or more images can only be references.

Reference-to-video tops out at 720p; ask for 1080p there and the request is refused.

### Parameters

| Flag | Values | Default |
|------|--------|---------|
| `--duration` | 1–15 (seconds) | 5 |
| `--resolution` | 480p, 720p, 1080p (1.5 only; not in reference-to-video) | 480p |
| `--aspect-ratio` | auto, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 | auto |
| `--model` | `<lane>/<model>`; prefer `grok-imagine-video-1.5` (preview alias accepted) | `grok-imagine-video` after selecting the Grok lane |
| `--as-reference` | (flag) with exactly one `--ref`: guide a new scene instead of animating that image | off |
| `--voice` | preset voice id, repeatable, max 3 (1.5 only) | (none) |
| `--topic` | any string | (none) |
| `--session` | session ID | (none) |
| `-o, --out` | output file path | saved under configured generated dir |
| `--json` | (flag) | false |

### Series Continuity (--topic)

`--topic` is legacy/best-effort series context. Prefer branch-local artifact
continuity with `ima2 video continue`, Classic "Continue here", gallery video
drag, or Node parent-video generation. Those flows use the previous generated
video's last frame plus its stored `revisedPrompt` lineage.

> **Continuation is last-frame image-to-video, not true video-to-video.** Only a single
> still frame carries over — motion, trajectory and camera movement are not preserved.
> Expect the next clip to start from that pose rather than to inherit momentum. Frames
> are pulled server-side with ffmpeg when the source is a generated file, falling back
> to in-browser canvas capture when ffmpeg is unavailable.

```bash
ima2 video "episode 1: morning routine" --topic "daily-vlog"
ima2 video "episode 2: commute" --model grok/grok-imagine-video --topic "daily-vlog"
```

### Planning Layer

Prompts are NOT sent directly to the video model. A Grok planner rewrites your prompt with web search context for better results. The `revisedPrompt` in the response shows what was actually sent. Default planner model is `grok-4.3` (configurable in settings UI).

Override the planner model per-request:

```bash
ima2 video "prompt" --model grok/grok-imagine-video --planner-model gpt-5.5
ima2 video "prompt" --model grok/grok-imagine-video --planner-model gpt-5.4
```

### Grok 4.3 Prompt Surfaces

| Surface | Files | Responsibility |
|---------|-------|----------------|
| Image search/planner | `lib/grokImageAdapter.ts` | Web-search context and final image prompt for Grok image generation/editing. |
| Video planner | `lib/grokVideoAdapter.ts`, `lib/grokVideoPlannerPrompt.ts` | Final video prompt for T2V/I2V/Ref2V, duration pacing, and continuity lineage when present. |
| Video analyzer | `routes/videoExtended.ts` | First/last-frame analysis prompt for recreating or continuing an existing generated video. |
| Agent/runtime prompt use | `lib/agentRuntime.ts`, card/template planner modules | Higher-level orchestration surfaces that may create image/video prompt inputs but do not replace the video planner contract. |

For video, the Grok 4.3 planner must produce one focused English prompt with:
core subject, expected action/motion, camera/composition, environment/style,
dialogue/audio intent, ending frame/continuity handoff, and constraints. If
`videoContinuity` exists, the lineage is authoritative context: continue from
the latest clip's final frame and final audio/dialogue state without restarting
the scene. The planner also applies duration pacing: use the selected seconds as
the full clip runtime, expand even short requests into a production-level
sequence, and make the clip feel complete through composition, blocking, camera
movement, motion rhythm, sound/dialogue timing, and an ending hold.

### Active Video Prompt Requirement

Blank video prompts are blocked. Weak natural-language prompts are allowed, but
agents should always write an active prompt that includes:

- **shot design**: opening frame composition, one motivated reveal or change,
  settling final frame — not a checklist of elements
- **camera intent**: choose the camera move that serves the scene (macro push-in
  for product, orbit for spatial VFX, handheld for documentary, crane for scale)
  — do not default to "slow dolly in"
- **production choices**: concrete material/texture, motivated lighting source,
  depth layers (foreground/mid/background), lens framing — instead of generic
  "cinematic" or "volumetric lighting"
- **sound**: music style, no music, room tone, or sound-effects-only
- **dialogue**: exact line in original language or explicit no-dialogue
- **ending frame**: final pose, camera state, last spoken words, and final sound
  cue — self-explanatory enough to serve as the first frame of a next clip
- **duration pacing**: beat structure scales with length — 1-4s gets one action,
  5-7s gets setup/turn/hold, 8-10s gets two connected beats, 11-15s gets a
  three-beat arc

The planner is model-aware: it adjusts for `grok-imagine-video` (simpler, bolder
composition at 480p) vs `grok-imagine-video-1.5` (finer detail, 1080p textures).
For 1.5 text-to-video, the server uses a white-canvas shim internally; the
planner automatically writes a fresh-scene prompt without referencing a source
image.

**Anti-slop**: the planner rejects generic prestige phrases ("AAA trailer",
"senior VFX artist", "shot on RED"), filler lighting ("volumetric", "neon glow"),
and unmotivated dark/moody defaults. Write what the camera actually sees.

### Prerequisites

```bash
ima2 grok login     # authenticate (manual-paste flow)
ima2 grok status    # verify connection
ima2 serve          # server must be running
```

### Output

SSE streaming events: `planning` → `submitted` → `progress` (0-100%) → `done`.
The `submitted` and `done` payloads include `requestedModel`, `effectiveModel`, and `modelFallback` so agents can report which model actually produced a clip when a request falls back. A request carrying `--voice` never falls back. CLI `--json` prints `video.requestedModel`, `video.effectiveModel`, and `video.modelFallback`; use `path`/`filename` for local chaining.

### Discover Valid Parameters

```bash
ima2 capabilities --json | jq '.valid.videoModels'
```

### Advanced Workflows

#### Image-First Video (best quality)

Generate a high-quality still image first, then animate it. This produces better results than text-to-video alone because the video model has a concrete visual anchor.

**Critical rule for i2v**: Compose ALL characters and the environment together in ONE image. Do NOT use individual portrait refs for i2v — the video model needs a single composed scene to animate from.

**Keyframe image provider rule (MANDATORY)**:
- **Primary**: GPT Image 2 (OpenAI, `provider: oauth`) with `quality: high`, maximum resolution matching the target video aspect ratio. For 16:9 video use `1792x1024`. For 1:1 use `1024x1024`. For 9:16 use `1024x1792`.
- **Fallback**: Grok (`provider: grok`, model `grok-imagine-image-quality`). Only aspect ratio must match — resolution does not matter because i2v accepts any resolution source image and internally rescales.
- GPT Image 2 produces superior keyframes: better lighting coherence, character consistency, and fine detail that survives i2v animation. Always try GPT first.
- The i2v model internally rescales the source image to its native resolution regardless of input size, so there is no benefit to upscaling a Grok fallback image.

**ref2v vs i2v decision**:

| Scenario | Use | Why |
|----------|-----|-----|
| Need 2+ character identity lock from separate refs | ref2v (`grok-imagine-video-1.5`, max 14 refs, up to 15s, 720p) | Refs lock character appearance |
| Single composed scene with all elements | i2v (`grok-imagine-video-1.5`, 1 ref) | Better motion quality from composed start |
| One subject, but a brand new setting | ref2v with one ref (`--as-reference`) | Keeps the subject without reproducing the source shot |
| Continue from previous video | `video continue` (last frame as i2v ref) | Lineage metadata preserved |

```bash
# Multi-character scene: compose BOTH characters in one image first
# Primary: GPT Image 2 at high quality, max resolution, aspect ratio matching 16:9 video
ima2 gen "cinematic wide shot of Bruce Lee in yellow tracksuit facing Elon Musk in dark gi, underground fight arena, dramatic lighting, 16:9" --quality high --size 1792x1024 -o scene.png

# Fallback if GPT fails: Grok quality model, match aspect ratio only
# ima2 gen "same prompt" --provider grok --model grok-imagine-image-quality --size 1824x1024 -o scene.png

# Then animate from the composed scene
ima2 video "Bruce throws a rapid jeet kune do combination" --ref scene.png --duration 10 --resolution 720p --aspect-ratio 16:9
```

#### Multi-Shot Video (connected scenes)

Create a sequence of connected clips using `--topic` for narrative continuity. Each generation receives context from previous clips in the same topic.

```bash
# Scene 1: Establishing shot
ima2 video "wide establishing shot of a busy Tokyo street at night, neon signs" \
  --topic "tokyo-night" --duration 5

# Scene 2: Medium shot (planner sees Scene 1's revised prompt)
ima2 video "medium shot following a person walking through the crowd" \
  --topic "tokyo-night" --duration 5

# Scene 3: Close-up (planner sees Scenes 1+2)
ima2 video "close-up of rain drops on a neon sign reflection" \
  --topic "tokyo-night" --duration 5
```

The planner receives previous prompts from the same topic as continuity context. This is best-effort prompt guidance, not a guarantee that subjects, palette, or style will remain identical. For branch-local continuation, use `ima2 video continue` instead.

#### Storyboard-to-Video Chaining (9-panel storyboard → i2v loop)

The highest-quality video production workflow. Since Grok i2v accepts only **one image input**, pack the entire action sequence into a single 3×3 (9-panel) storyboard grid image. The i2v model reads the panels as a visual script and animates the progression.

**Full workflow**:

```
keyframe image (GPT high)
    → GPT i2i with reference → 9-panel storyboard grid
        → Grok i2v (reads panels, animates sequence)
            → extract last frame
                → GPT i2i with last frame → next 9-panel storyboard
                    → Grok i2v
                        → repeat
```

**Step 1 — Opening keyframe** (GPT Image 2, `quality: high`, max resolution matching target aspect ratio):

```bash
ima2 gen "cinematic wide shot of two fighters in a dojo, dramatic lighting" \
  --quality high --size 1792x1024 --storyboard
```

Fallback: Grok `grok-imagine-image-quality`, match aspect ratio only — resolution does not matter because i2v internally rescales.

**Step 2 — 9-panel storyboard grid** (GPT Image 2 with keyframe as reference):

```bash
# Use the keyframe as reference, prompt describes 9 sequential panels
ima2 gen "Using this scene as reference, create a 3x3 storyboard grid (9 panels, thin black borders) showing a 15-second action sequence. Panel 1 (0s): ... Panel 2 (2s): ... Panel 9 (15s): ... Maintain identical character designs across all panels." \
  --ref keyframe.png --quality high --size 1024x1024
```

**9-panel storyboard rules**:
- Grid layout: 3×3, thin black borders between panels
- Read order: left-to-right, top-to-bottom (panels 1-9)
- **Panel 1 (top-left) MUST be solid black** — this is a lead-in frame, not content. The i2v model starts from Panel 1's pixels; a black frame ensures the video begins with a clean fade-in instead of showing the grid. The 1-second black lead-in is auto-trimmed by the server.
- Panels 2-9 carry the action sequence (8 key moments with timestamps)
- Character designs MUST be identical across all panels
- Vary camera angle per panel for dynamic energy
- Each panel should look like a film still, not a sketch
- Do NOT add timestamp labels or text to panels — they burn into the video
- Square format (1024×1024) works best — i2v rescales internally

**Step 3 — Animate storyboard via i2v**:

```bash
ima2 video "This is a 9-panel storyboard. Animate the full sequence as one continuous 15-second clip following panels left-to-right, top-to-bottom. Panel 1: ... Panel 9: ... Sound: [describe music, SFX, dialogue]. Camera: [describe movement per beat]." \
  --ref storyboard.png --duration 15 --resolution 720p --model grok-imagine-video-1.5
```

**i2v prompt rules for storyboard input**:
- Explicitly state "This is a 9-panel storyboard" at the start
- Reference each panel by number with its action description
- Always include Sound/Music direction — never leave audio undefined
- Include Camera direction per beat (wide, close-up, tracking, handheld, slow-mo)
- Describe the end frame explicitly for continuation

**Step 4 — Extract last frame and repeat**:

```bash
# Extract last frame via ffmpeg
ffmpeg -sseof -0.1 -i clip.mp4 -frames:v 1 -q:v 2 -update 1 lastframe.jpg -y

# Generate next storyboard using last frame as reference
ima2 gen "Using this fight scene last frame as reference, create a 3x3 storyboard grid..." \
  --ref lastframe.jpg --quality high --size 1024x1024

# Animate next storyboard
ima2 video "This is a 9-panel storyboard..." --ref storyboard2.png --duration 15
```

**Fallback: continueFromVideo** — If a storyboard image triggers content moderation (common with intense action/fight scenes), fall back to `video continue` with a detailed text prompt instead:

```bash
ima2 video continue "detailed action description with sound and camera direction" \
  --video "$PREV_CLIP" --duration 15
```

**Clip duration is flexible** — use 15s for action-dense sequences with many beats, 10s for transitions, 5s for quick cuts. The 9-panel storyboard works best with 15s clips (each panel ≈ 1.5-2s of screen time).

**Music and sound are MANDATORY** in i2v prompts — describe the score (orchestral, percussion, taiko drums), sound effects (impacts, whooshes, crashes), dialogue lines, and audio transitions. "No music" or undefined audio produces flat, lifeless output.

#### Video Continuation (extend/sequel)

To continue from an existing video's last frame:

```bash
# Get the last generated video filename
LAST=$(ima2 ls -n 1 --json | jq -r '.items[0].filename')

# True extension keeps the original clip and appends new motion
ima2 video extend "the camera slowly pulls back revealing the full scene" --video "$LAST" --duration 6

# Branch-local sequel keeps revisedPrompt lineage and starts from the last frame
ima2 video continue "from the last frame, the camera slowly pulls back, no music, footsteps echo, end on a still wide shot" --video "$LAST"
```

Or in the UI: use "Continue here" on a video, drag a video from gallery/history
to the prompt composer, or create a child from a video node. These flows attach
the previous video's last frame and carry a branch-local `videoContinuity`
lineage stack. The stack stores up to 4 revised prompts using
`keep-start-plus-latest-3`: start clip is preserved, and the newest three clips
stay in context.

`ima2 video extend` is xAI native extension: it returns original+extension as a
combined artifact. `ima2 video continue` is ima2 branch continuation: it creates
a new clip from the generated video's last frame and persists lineage metadata.

#### Marketing/Product Video

Generate a product showcase video from a product image:

```bash
# Step 1: Generate or provide product image
ima2 gen "clean product photo of wireless earbuds on white background" -o product.png

# Step 2: Create dynamic product video
ima2 video "sleek product reveal with rotating camera, premium feel, studio lighting" \
  --ref product.png --duration 10 --resolution 720p --aspect-ratio 16:9
```

#### Style-Consistent Series

For maintaining visual style across multiple videos (e.g., social media series):

```bash
# First video establishes the style
ima2 video "minimalist animation of a coffee cup, flat design, pastel colors" \
  --topic "coffee-series" --duration 5

# Subsequent videos inherit style via planner context
ima2 video "same style, now showing latte art being poured" \
  --topic "coffee-series" --duration 5

ima2 video "same style, steam rising from the cup" \
  --topic "coffee-series" --duration 5
```

#### Batch Generation (scripting)

```bash
#!/bin/bash
PROMPTS=("sunrise over ocean" "waves crashing" "seagulls flying" "sunset colors")
TOPIC="ocean-day"

for prompt in "${PROMPTS[@]}"; do
  ima2 video "$prompt" --topic "$TOPIC" --duration 5 --json >> results.jsonl
  sleep 2  # rate limiting
done
```

### Limitations

- Max 15 seconds per clip (extend adds 1-15s more)
- Reference-to-video: 1-14 refs, 720p ceiling. Duration is 15 seconds on
  `grok-imagine-video-1.5` and 10 seconds on `grok-imagine-video` — xAI's own rule,
  measured 2026-09-08. Do not confuse it with the mode-wide 10-second clamp removed in
  v3.8.0 (issue #155): that one was ours and applied to every model
- A preset voice with no reference image also selects reference-to-video
- 1080p resolution is available for `grok-imagine-video-1.5` prompt-only text-to-video via the white-canvas I2V shim, and for image-to-video with a single image/frame source
- Video edit/extend: grok-imagine-video only (1.5 is not supported)
- Video edit input: ~8.7 seconds is our own measured practical ceiling, not a limit xAI enforces
- Video extend: extension duration 1-15 seconds, and it is the length of the ADDED
  segment, not the total. xAI's docs say 2-10; live probing accepts 1 and 11 and
  rejects 0 and 16

#### Provenance of the limits above

Do not re-litigate these from doc snippets alone. Two different kinds of fact are
mixed in this section, and they age differently.

**Owner-measured, not in any public doc — trust it, do not "correct" it away:**

| Limit | Source |
|---|---|
| Video edit input max **8.7 seconds** | Owner's own empirical measurement, recorded in `docs/grok-video-i2v-research.md` (2026-05-30). No xAI doc states this number. It is not a hallucination and it is not stale-by-default — leave it in place unless a fresh measurement contradicts it. |

**Live-probed against `api.x.ai` on 2026-08-20 (real requests, real responses):**

| Behavior | Observed |
|---|---|
| `grok-imagine-video-1.5` + `/v1/videos/edits` | `400 "Video editing is not supported for this model."` |
| `grok-imagine-video-1.5` + `/v1/videos/extensions` | `400 "Video extension is not supported for this model."` |
| `grok-imagine-video` (base) + edit / extend | `200` → `done` (both work) |
| Edit `duration` / `resolution` overrides | Accepted with `200` but **silently ignored** — output inherits the source video's properties, capped at 720p |
| Extension `duration` | 1-15 accepted (1, 2, 10 and 11 all return `200`); 0 and 16 return `400 "Duration must be between 1 and 15 seconds"`. xAI's docs say 2-10 — the docs are narrower than the endpoint (re-measured 2026-09-08). |
| R2V reference count | 14 max; 15 → `400 "Too many reference images: 15. Maximum allowed is 14."` on both models. Was 7 until xAI doubled it; @imagine announced 14 on 2026-09-02 and the API guide still says 7. |
| R2V duration on `grok-imagine-video` | 10s max; 11 → `400 "Duration 11s exceeds the maximum allowed for reference-to-video, which is 10s."` |
| `reference_audios` on `grok-imagine-video` | `400 "reference_audios is not supported for this model."` — voices need 1.5 |
| Audio-only R2V (voice, no images) | Accepted; a voice alone selects reference-to-video and the r2v duration ceiling applies |
| R2V + 1080p | `400 "1080p video resolution is not supported for reference-to-video requests."` |
| R2V duration 15 on 1.5 | `200` → `done`, `video.duration=15`. The mode-wide 10s clamp removed in v3.8.0 was ours; the base model's 10s above is xAI's |
| R2V with a single reference image | Accepted (`200`) — 2+ is an ima2 convention, not an API requirement |
| `reference_audios: [{"voice_id": "eve"}]` on 1.5 | `200` → `done` (preset voices work; up to 3) |
| Rate limit | 2 requests/second per team; exceeding it returns `429` |

The 1.5-vs-base split is not symmetric: **1.5** owns reference images, 1080p, and 15s;
**base** owns video editing and extension. Neither model does both.

### Video Editing (V2V)

Edit an existing video with a text prompt. This uses xAI's real video edit endpoint and saves the result as a generated video artifact.

```bash
# Get the local video file from a previous generation
VIDEO_FILE=$(ima2 video "ocean waves" --json | jq -r '.path')

# Edit: change style
ima2 video edit "Make the water glow neon blue, bioluminescent" --video "$VIDEO_FILE"

# Edit: add object
ima2 video edit "Add a sailboat in the distance" --video "$VIDEO_FILE"

# Edit: change mood
ima2 video edit "Make it stormy with dark clouds" --video "$VIDEO_FILE"
```

Constraints: grok-imagine-video only, input mp4 <=8.7s (owner-measured 2026-05-30; not
in any xAI doc — see Provenance above). `grok-imagine-video-1.5` returns
`400 "Video editing is not supported for this model."` (verified 2026-08-20).
`duration` and `resolution` are accepted but ignored: the output inherits the source
video's properties, capped at 720p. Use `-o/--out` if you also need a local copy
outside the generated directory.

### Video Extension (Continue from Last Frame)

Extend a video from its last frame using xAI's video extension endpoint. The output combines the source video and extension, but continuity quality is provider-dependent.

Constraints: grok-imagine-video only, extension duration 1-15s. `grok-imagine-video-1.5`
returns `400 "Video extension is not supported for this model."` (re-verified 2026-09-08).
`duration` is the length of the **appended segment**, not the total: a 10s source with
`duration: 5` returns a 15s video. xAI's docs say the range is 2-10; live probing accepts
1 and 11 and refuses only 0 and 16, so the range above is the measured one.

```bash
# Generate initial clip
VIDEO_FILE=$(ima2 video "a bird takes flight from a branch" --duration 5 --json | jq -r '.path')

# Extend: add 5 more seconds
ima2 video extend "the bird soars higher into the clouds" --video "$VIDEO_FILE" --duration 5

# Chain extensions for longer videos
EXTENDED=$(ima2 video extend "camera follows the bird" --video "$VIDEO_FILE" --duration 5 --json | jq -r '.filename')
ima2 video extend "bird lands on a distant tree" --video "$EXTENDED" --duration 5
```

### Video Frame Extraction

Extract frames from generated videos for use as references or analysis.

```bash
# Extract last frame
ima2 video frame 1780226256355_50252101.mp4 --last -o lastframe.png

# Extract frame at specific timestamp
ima2 video frame 1780226256355_50252101.mp4 --position 2.5 -o frame_2s.png

# Use extracted frame as reference for new generation
ima2 video "continue this scene" --ref lastframe.png
```

### Video Analysis (Recreation Prompt)

Analyze first and last video frames with Grok 4.3 image understanding to get a structured recreation prompt. This infers motion from frames; it is not full temporal video understanding.

```bash
# Analyze a generated filename
ima2 video analyze 1780226256355_50252101.mp4

# Output: structured prompt with shot type, inferred camera movement, lighting, color, motion, mood

# Use the analysis to recreate with variations
ANALYSIS=$(ima2 video analyze 1780226256355_50252101.mp4 --json | jq -r '.analysis')
ima2 video "$ANALYSIS but in anime style" --ref reference.png
```

### Audio in Video (Prompt-Controlled)

The API does not expose a separate audio on/off or audio-track control. Treat audio as prompt-compiled: describe dialogue, music, no-music, room tone, or sound-effects-only behavior in the video prompt. Output is provider-dependent, but the prompt must be explicit when audio matters.

```bash
# Explicit sound direction
ima2 video "ocean waves crashing on rocks with seagull calls and distant thunder"

# Music direction
ima2 video "timelapse of city at night, lo-fi hip hop background music"

# Dialogue
ima2 video "person speaking to camera: Hello world, welcome to my channel"

# No music / room tone
ima2 video "quiet forest scene, no background music, only subtle wind and leaves rustling"

# Sound effects only
ima2 video "no music, only footsteps, cloth movement, rain hits, and one radio click"
```

For continuity clips, always define the final audio state: whether dialogue finishes before the cut, music resolves or continues, or a sound effect carries into the next clip.

### Structured Video Prompt Template

Use this structure for serious video generation, Ref2V, extension prompts, and
multi-shot continuity. A static visual description is not enough. Write like a
director calling a shot, not filling out a form.

```text
Opening frame: composition, depth layers, spatial staging, material/texture.
Motivated movement: what changes and why — reveal, follow, discover, tension.
Camera intent: the specific move that serves this scene (macro push-in, orbit,
  lateral slider, rack focus, locked overhead, handheld, crane).
Visual turning point: a shift in focus, scale, light, or subject state.
Dialogue: speaker (by visual appearance, not name), exact line in original
  language, timing — or "no dialogue".
Sound: music style with swell/cut/resolve behavior, or "no background music,
  room tone only", or specific SFX (footsteps, rain, machine hum, impact).
Settling final frame: stable pose, camera angle, background, lighting, held
  audio state — self-explanatory for continuation.
Negative constraints: no visible subtitles/text unless requested, preserve
  identity/style.
```

When creating a sequence, write both motions explicitly: "A motion" for the
first clip and "B motion" for the continuation. For last-frame Ref2V, use ref 1
as identity/style and ref 2 as current state/last frame.

**Shot discipline (cross-vendor official guidance):**

- **One camera move + one primary action per shot** is the most reliable
  recipe; short clips follow instructions better than long ones. Write actions
  as observable, timed beats: "takes four steps to the window, pauses, pulls
  the curtain in the final second" — not abstract descriptions.
- **Split audio into explicit channels**: Dialogue (speaker label + exact
  short line), Ambience, SFX, Music. Declare music policy explicitly —
  "diegetic only", "no score", or a concrete style. A 4-5s clip fits 1-2 short
  dialogue exchanges at most.
- **I2V prompts describe motion, not the image.** When a reference image or
  last frame drives the clip, the image already fixes subject, composition,
  color, and lighting — do not re-describe them. Write only: subject motion,
  scene reaction, camera motion, motion style.
- **Reuse identical anchor phrases across clips.** For multi-clip continuity,
  repeat the same character/wardrobe/palette wording verbatim in every prompt
  of the series.
- **Failure recovery ladder**: freeze the camera, then simplify the action,
  then clear the background, then re-add one element per iteration.

**Example — product reveal (10s, 1.5, 1080p):**
```text
A single continuous macro shot begins inches above a matte black desk surface,
tight on the brushed aluminum edge of wireless earbuds catching a narrow softbox
reflection. The camera glides laterally as focus racks from the charging case
texture to the earbud stem, revealing the full product silhouette against soft
warm-gray negative space. A gentle ambient hum, no music. The camera settles
into a medium close-up with the product centered, soft rim light from behind,
holding steady on the final composition.
```

### End Frame Guidance (via Ref2V)

Guide the video toward a desired final scene using reference images:

```bash
# Start frame + end frame concept
ima2 video "smooth transition from day to night" \
  --ref sunrise.png --ref nightsky.png
```

The planner treats reference images as subject/style/composition guidance. This is best-effort guidance, not a guaranteed final-frame constraint.

### Soul Character / Face Consistency (via Ref2V)

Guide character identity across multiple videos using reference photos:

```bash
# Provide face references for consistency
ima2 video "person walking through a park, smiling" \
  --ref face_front.png --ref face_side.png --ref face_smile.png

# Same character in different scenes
ima2 video "same person now sitting at a cafe" \
  --ref face_front.png --ref face_side.png --topic "character-series"
```

### Marketing / Product Video

Turn a product image into a dynamic showcase video:

```bash
# Step 1: Generate or provide product image
ima2 gen "clean product photo of wireless earbuds on white background" -o product.png

# Step 2: Create product video
ima2 video "sleek product reveal, rotating camera, premium studio lighting" \
  --ref product.png --duration 10 --aspect-ratio 16:9

# Step 3: Extend with lifestyle shot
PRODUCT_VID=$(ima2 video "product reveal" --ref product.png --json | jq -r '.path')
ima2 video extend "person puts on the earbuds and smiles" --video "$PRODUCT_VID" --duration 5
```

## MCP Provider Tool Contracts

<!-- mcp-tools:generated:start -->
<!-- Generated by scripts/generate-contract-docs.mjs — do not edit by hand. -->

### Machine tool contracts (catalog sha256:863c92848fba)

Agents: run `ima2 tools list --json` for the live view; this section is the bundled-snapshot projection.

#### `ima2` (5)

| tool | executable via | description |
|---|---|---|
| `ima2.generate_image` | agent runtime | Generate one or more images. Supports fanout: provide one prompt per variant. |
| `ima2.generate_video` | agent runtime | Generate a single video with Grok Imagine. If the session has a last image, it is used as the image-to-video source automatically; prompt-on |
| `ima2.get_generation_errors` | agent runtime | Read-only lookup of the session's recent generation failures (failed queue jobs and error turns). Use when the user asks why a generation fa |
| `ima2.get_image_context` | agent runtime | Load the session image context manifest (previous images, current image, locks). Runs automatically before image generation. |
| `ima2.web_search` | agent runtime | Search the web for factual visual references before generating. Only available when web search is enabled for the session. |

#### `mcp.higgsfield` (73)

| tool | executable via | description |
|---|---|---|
| `mcp.higgsfield.animation_actions` | — | Read-only catalog of the 3D rig animation library (678 actions: locomotion, gestures, dancing, combat, daily actions). Search by name or bro |
| `mcp.higgsfield.balance` | — | Get the user's available credits and current subscription plan. For transaction history, call `transactions` instead. |
| `mcp.higgsfield.cancel_trial_auto_renewal` | — | Cancel the auto-renewal of the Higgsfield MCP 3-day free Plus trial. Call this when the user asks to cancel the trial, cancel auto-renewal,  |
| `mcp.higgsfield.confirm_billing_purchase` | — | INTERNAL — invoked ONLY by the plans widget on an explicit user Confirm click. Do NOT call this tool yourself; it charges the user's real sa |
| `mcp.higgsfield.confirm_trial_cancel` | — | INTERNAL — invoked ONLY by the cancel-trial confirmation widget on an explicit user click of 'Cancel auto-renewal'. Do NOT call this tool yo |
| `mcp.higgsfield.create_voice` | — | Open the Create Voice Apps UI. Call this immediately when the user asks to create a voice, call the Create Voice tool, or needs a local brow |
| `mcp.higgsfield.create_voice_from_confirmed_audio` | — | Backend-only creation of a cloned voice from an already confirmed audio upload. Do not call this tool until audio_media_id and name are alre |
| `mcp.higgsfield.create_website` | — | Start a new full-stack website. Creates the website and a git repo: a React 19 + TanStack Start app, server-rendered, in ONE Cloudflare Work |
| `mcp.higgsfield.deploy_game` | — | Deploy a built browser game from an uploaded zip archive and get a shareable play URL. Deploying also lists the game in the Higgsfield marke |
| `mcp.higgsfield.deploy_website` | — | Build and deploy the website via CI, then return its live URL. Every deploy ships the live site at the website's public URL (there is no sep |
| `mcp.higgsfield.dubbing` | — | Dub a video into another language: translate the spoken audio, synthesize it in the target language, and lip-sync the result back onto the v |
| `mcp.higgsfield.explainer_video` | — | Assemble an explainer / narrated video from its per-block clips and voice takes: stitches two or more existing video clips into one MP4, in  |
| `mcp.higgsfield.generate_3d` | — | Generate a 3D GLB mesh. Use `models_explore(type:'3d')` to pick a model and see its `medias[].roles` and `parameters`. Apps UI local file: c |
| `mcp.higgsfield.generate_audio` | — | Generate speech/voice audio (text-to-speech). DEFAULT model: seed_audio (Seed Audio 1.0 by ByteDance) — use it unless the user explicitly as |
| `mcp.higgsfield.generate_image` | `POST /api/mcp/generate` | Generate an image. Apps UI local file media: call `media_upload_widget`; do not ask for Claude chat attachments because remote tools cannot  |
| `mcp.higgsfield.generate_video` | `POST /api/mcp/generate` | Generate a video. Apps UI local file: call `media_upload_widget`; do not ask for Claude chat attachments; remote tools cannot read them. Web |
| `mcp.higgsfield.get_explainer_presets` | — | Show the explainer video style presets (CMS-managed catalog). Returns preset ids, names, and preview media. When the user picks one, resolve |
| `mcp.higgsfield.get_game_creation_bundle_file` | — | Read a safe text file or directory from the game-generation resource folder. Use this after get_game_creation_instructions when the instruct |
| `mcp.higgsfield.get_game_creation_instructions` | — | REQUIRED before creating or editing any browser game. Reads the game-generation SKILL.md resource and returns the current list of files avai |
| `mcp.higgsfield.get_website_creation_bundle_file` | — | Read a safe text file or directory from the website-builder-flow resource folder. Use this after get_website_creation_instructions when the  |
| `mcp.higgsfield.get_website_creation_instructions` | — | REQUIRED before creating or editing any website with the website tools (create_website / website_repo_access / deploy_website / website_db / |
| `mcp.higgsfield.get_workflow_bundle_file` | — | Read a safe text file or directory from a workflow's resource folder. Use this after get_workflow_instructions when the SKILL.md requires a  |
| `mcp.higgsfield.get_workflow_instructions` | — | Discover and load multi-step content-generation workflows (each a bundled SKILL.md that orchestrates the generate_* tools). Call with NO arg |
| `mcp.higgsfield.job_display` | — | Show a single generation result in the UI widget by job ID. Pass exactly one job ID — to display multiple generations, call this tool once p |
| `mcp.higgsfield.job_status` | — | Check the status and results of an async job. Returns instantly. For non-terminal jobs the response includes poll_after_seconds — wait that  |
| `mcp.higgsfield.list_voices` | — | List available voices for speech and voice tools. Returns built-in preset voices plus the user's own custom voices. Each voice has a voice_i |
| `mcp.higgsfield.list_websites` | — | List the websites you own — each with its id, name, slug, and live URL. Use this to find the id of a website you created earlier so you can  |
| `mcp.higgsfield.list_workspaces` | — | List every workspace the user can access (their private workspace plus any shared/team workspaces). The `is_selected` field marks which work |
| `mcp.higgsfield.media_confirm` | — | Confirm file uploads after using the upload_url method. Call this after the curl uploads succeed. Supports confirming multiple uploads at on |
| `mcp.higgsfield.media_import_url` | — | Import an HTTPS image, video, or audio URL into Higgsfield storage and return a confirmed media_id. Use this before generate_image/generate_ |
| `mcp.higgsfield.media_upload` | — | Upload media for use in generation, or general files (documents, archives, code) for sharing. Returns presigned URLs for clients that can up |
| `mcp.higgsfield.media_upload_widget` | — | Open the Higgsfield upload widget for a user-provided local image, video, or audio file. Call this immediately when the user says they have  |
| `mcp.higgsfield.models_explore` | — | Find generation models. Use recommend with goal + input context; use get for model constraints. |
| `mcp.higgsfield.motion_control` | — | Animate an existing character image with the motion and camera movement from a reference video using Kling 3.0 Motion Control. Use this when |
| `mcp.higgsfield.outpaint_image` | — | Expand or uncrop an existing image by outpainting beyond the original frame while preserving the source content. Use this when the user asks |
| `mcp.higgsfield.participate_in_contest` | — | Enter the website in the current Higgsfield app contest, together with the social-media links promoting it. A website not yet PUBLISHED to t |
| `mcp.higgsfield.personal_clipper_create` | — | Turn YouTube videos into ready-to-share clips. This is a long-running job and can take up to 30+ minutes. Before starting, ask the user how  |
| `mcp.higgsfield.personal_clipper_jobs` | — | Show recent clipping jobs. |
| `mcp.higgsfield.personal_clipper_status` | — | Check clip creation progress. |
| `mcp.higgsfield.presets_show` | — | Show available Higgsfield presets for image-to-video generation. Returns preset ids, names, previews, and descriptions. |
| `mcp.higgsfield.publish_game` | — | Publish a deployed game to the Higgsfield marketplace. This does not deploy anything: the game must already be live — use deploy_game first, |
| `mcp.higgsfield.publish_website` | — | Publish the website: lists the website's CURRENT LIVE production deploy on the Higgsfield community feed ('show in feed'), where other users |
| `mcp.higgsfield.reframe` | — | Expand or reframe an existing video to a new aspect ratio while preserving the source content. Use this when the user asks to make a video v |
| `mcp.higgsfield.remove_background` | — | Remove or cut out the background from an existing image or video. Use this when the user asks for background removal, a transparent backgrou |
| `mcp.higgsfield.rename_website` | — | Rename the website's SUBDOMAIN (the slug in its public URL). The site is re-deployed under the new subdomain and the OLD subdomain STOPS WOR |
| `mcp.higgsfield.resolve_explainer_preset` | — | Resolve an explainer video style preset (from get_explainer_presets) into a style reference media_id: the backend imports the preset's style |
| `mcp.higgsfield.reveal_generation` | — | Confirm the user has rights to the content of an `ip_detected` generation and flip its status to `completed`. Backend accepts only seedance- |
| `mcp.higgsfield.select_workspace` | — | Set or clear the active workspace — the one all subsequent MCP operations bill against and read from (generations, balance, transactions, up |
| `mcp.higgsfield.shorts_studio_create` | — | Start a Shorts Studio short: restyle one uploaded source video (4s–120s) into a set of AI-generated short-form clips using a style preset. P |
| `mcp.higgsfield.shorts_studio_create_preset` | — | Create a user-owned Shorts Studio style preset from reference media (videos + images). This just stores a STYLE — no generation, no credits. |
| `mcp.higgsfield.shorts_studio_list_presets` | — | Browse Shorts Studio style presets — the visual STYLE a short is restyled toward. Use this when the user wants to make a short and needs to  |
| `mcp.higgsfield.shorts_studio_list_sessions` | — | List the caller's past Shorts Studio sessions (newest first) to find a session_id to poll with shorts_studio_status. |
| `mcp.higgsfield.shorts_studio_status` | — | Poll one Shorts Studio session. Returns {id, status, job_ids}. status='completed' means every clip job is terminal (not necessarily successf |
| `mcp.higgsfield.show_characters` | — | Soul Characters widget — reusable trained identity models. Actions: `list` (browse), `train` (needs `name` + 5-20 ref images, ~10 min, non-b |
| `mcp.higgsfield.show_generations` | — | Browse past completed non-Marketing Studio generations and render them directly in the widget. Returns generations with {id, type, status, m |
| `mcp.higgsfield.show_marketing_studio` | — | When replying to the user, do not say `ms_image` — refer to it as "DTC Ads". |
| `mcp.higgsfield.show_marketing_studio_generations` | — | Browse past completed Marketing Studio generations only. Returns Marketing Studio video and ad/image generations with {id, type, status, mod |
| `mcp.higgsfield.show_medias` | — | List your uploaded media files by type. Returns media IDs, URLs, and creation timestamps. Pass media IDs as value in the medias array of gen |
| `mcp.higgsfield.show_plans_and_credits` | — | Open the single combined pricing widget for everything billing-related. The widget has two tabs the user can switch between: **Upgrade Plan* |
| `mcp.higgsfield.show_reference_elements` | — | Elements widget — reusable characters / environments / props per workspace. Actions: |
| `mcp.higgsfield.sync_agents` | — | Sync Agents — imports the user's user-authored Skills and a personality dump from the current host LLM into Higgsfield. One trigger, one upl |
| `mcp.higgsfield.transactions` | — | List the user's credit transactions (spend/refund/grant/deduct), newest first. Paginated: if next_cursor is not null, pass it as cursor to g |
| `mcp.higgsfield.upscale_image` | `POST /api/mcp/media-action` | Upscale and enhance an existing image. Use this when the user asks to upscale, enhance, or increase the resolution of an image to 2K/4K. Thi |
| `mcp.higgsfield.upscale_video` | `POST /api/mcp/media-action` | Upscale and enhance an existing video. Use this when the user asks to upscale, enhance, sharpen, denoise, restore, or convert a video to hig |
| `mcp.higgsfield.video_analysis_create` | — | Start a scene-by-scene analysis of a video. Provide EXACTLY ONE of: (a) video_input_id — UUID of a video the user has uploaded via media_upl |
| `mcp.higgsfield.video_analysis_jobs` | — | List the user's video analyses in the current workspace, newest first. Paginate by passing the previous response's cursor. |
| `mcp.higgsfield.video_analysis_status` | — | Get the status and result of a video analysis. Poll this after video_analysis_create until status='completed' (scenes populated) or 'failed' |
| `mcp.higgsfield.virality_predictor` | — | Virality Predictor predicts a video's virality potential, engagement, attention, audience response, retention risk, hook strength, and creat |
| `mcp.higgsfield.voice_change` | — | Replace the spoken voice in a video with a different voice while keeping the original timing and visuals, then re-merge the new audio onto t |
| `mcp.higgsfield.website_db` | — | Inspect the website's database (D1 / SQLite), READ-ONLY. The website has ONE database — the live site's real data. Pick an operation: 'table |
| `mcp.higgsfield.website_repo_access` | — | Get direct git access to a website's repo to edit it — THE way to get the website's code. Returns the repo URL, branch, slug, and a scoped t |
| `mcp.higgsfield.website_secrets` | — | Manage a website's SECRETS (environment variables: API keys, tokens). Set them HERE instead of hardcoding them in source. One tool, three op |
| `mcp.higgsfield.website_status` | — | Get the website's deploy status — the live URL and the status of the last deploy. Use to check a deploy that returned 'pending', or to fetch |

#### `mcp.runway` (14)

| tool | executable via | description |
|---|---|---|
| `mcp.runway.complete_upload` | — | Finalize a file upload and get the asset URL. |
| `mcp.runway.edit_video` | `POST /api/mcp/media-action` | Edit an existing video with Runway's Aleph 2.0 in-context video editor: it changes ONLY what you ask for and preserves everything else — sub |
| `mcp.runway.feedback` | — | Call this when you (the AI agent) get stuck using Runway tools. |
| `mcp.runway.generate_image` | `POST /api/mcp/generate` | Generate OR edit an image using a Runway-hosted image model. This is the only image tool — there is no separate "edit_image" tool. Pass the  |
| `mcp.runway.generate_multishot_video` | — | Generate a multi-shot video — 3 to 5 connected scenes from a single story or per-shot prompts. Powered by Kling 3.0 (standard at 720p, pro a |
| `mcp.runway.generate_product_marketing_video` | — | Generate a polished creative product ad video from a product URL or product image plus a campaign idea. |
| `mcp.runway.generate_video` | `POST /api/mcp/generate` | Generate OR edit a video using a Runway-hosted video model. Pass the source video as `referenceVideo` to edit/restyle it. |
| `mcp.runway.get_task` | — | Gets details for a Runway task by ID — used to check status and retrieve the result of a generation/edit task once it completes. Generation  |
| `mcp.runway.init_upload` | — | Initialize a file upload to Runway. Returns temporary upload URLs for direct upload. |
| `mcp.runway.list_recent` | — | Lists recent uploaded and generated assets for the authenticated workspace. Returns asset IDs, media types, task IDs when available, and reu |
| `mcp.runway.list_workspaces` | — | Lists every Runway workspace the authenticated user belongs to, with role and a compact disabled-model summary per workspace. The MCP connec |
| `mcp.runway.upscale_image` | `POST /api/mcp/media-action` | Upscale an existing image to a higher resolution (2x, 4x, 8x, or 16x) using Runway's AI image upscaler. Use this to sharpen, denoise, and in |
| `mcp.runway.upscale_video` | `POST /api/mcp/media-action` | Upscale an existing video to a higher resolution (up to 4K) using Runway's AI video upscaler. Use this to sharpen, clean up, and increase th |
| `mcp.runway.whoami` | — | Returns the authenticated Runway user profile, the workspace this MCP connection is pinned to (chosen at sign-in), and the list of image/vid |

<!-- mcp-tools:generated:end -->
### Preset Voices (1.5 only)

`grok-imagine-video-1.5` can give the subject a speaking voice. Pass up to three preset
voices; the base model rejects the field outright.

```bash
ima2 video "the person from <IMAGE_1> greets the camera with <AUDIO_0>" \
  --ref portrait.png --as-reference --voice eve --duration 6 --resolution 720p
```

Address voices in the prompt as `<AUDIO_0>`, `<AUDIO_1>`, `<AUDIO_2>`, the same way
reference images are `<IMAGE_1>`..`<IMAGE_N>`. A voice nobody is assigned to in the
prompt does not get used.

Known presets include `ara`, `eve`, `leo`, `rex`, `sal`, `carina`, `luna`, `orion`,
`iris`, `atlas`. **This list is a hint, not an allowlist.** xAI owns the roster and also
accepts custom voice ids, so an unknown id comes back as a 400 that names every voice it
will take — read that error rather than guessing from this page.

### Video Editing (V2V)
