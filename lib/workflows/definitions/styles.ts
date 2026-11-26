/**
 * Restyle presets. Our own names and wording: broad art-direction families, each a prompt
 * for the first-frame stylization. No third-party style names, copy or plates.
 */
export interface StylePreset {
  label: string;
  prompt: string;
}

export const STYLE_PRESETS: Readonly<Record<string, StylePreset>> = {
  "cel-anime": { label: "Cel anime", prompt: "Japanese cel animation: clean ink outlines, flat color fills, two-tone shading, hand-painted backgrounds." },
  "clay-stop-motion": { label: "Clay stop-motion", prompt: "Stop-motion clay animation: sculpted plasticine figures with thumbprint texture, miniature handmade sets, soft studio light." },
  "felt-craft": { label: "Felt craft", prompt: "Felted wool puppets on craft-paper and fabric sets, fuzzy fiber texture, tabletop miniature scale." },
  "low-poly": { label: "Low poly", prompt: "Low-poly 3D: faceted geometry, flat-shaded polygons, simple gradient sky, crisp edges." },
  "toy-cgi": { label: "Toy CGI", prompt: "Glossy rounded 3D animation that looks like collectible toys, soft global illumination, saturated plastic materials." },
  "comic-ink": { label: "Comic ink", prompt: "Comic book art: bold ink contours, halftone dot shading, flat print colors, strong blacks." },
  "watercolor": { label: "Watercolor", prompt: "Loose watercolor painting: soft washes, visible paper grain, colors bleeding at the edges." },
  "gouache": { label: "Gouache", prompt: "Gouache illustration: opaque matte paint, visible brush strokes, flat graphic color shapes." },
  "oil-paint": { label: "Oil paint", prompt: "Painterly oil-paint look: thick impasto strokes, rich pigment, painted light and shadow." },
  "pixel-art": { label: "Pixel art", prompt: "16-bit pixel art: limited palette, crisp square pixels, ordered dithering, no anti-aliasing." },
  "retro-console-3d": { label: "Retro console 3D", prompt: "Late-1990s console 3D graphics: low-resolution textures, vertex lighting, chunky polygons." },
  "yarn-world": { label: "Yarn world", prompt: "Everything knitted from yarn: visible stitches, wool fuzz, cozy handmade textures." },
  "ink-noir": { label: "Ink noir", prompt: "Black-and-white graphic noir: hard chiaroscuro shadows, ink-wash textures, high contrast." },
  "neon-synth": { label: "Neon synth", prompt: "Neon-lit synthwave 3D: dark scenes, glowing magenta and cyan rim light, reflective wet surfaces." },
};
