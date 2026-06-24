import { clamp, hexToRgb, rgbToHex, colorAlpha, withAlpha, rgbToHsv, hsvToRgb } from './color.utils';

/** One channel's Levels parameters (input black/white + gamma, output black/white). */
export interface LevelCh {
  inB: number;
  inW: number;
  gamma: number;
  outB: number;
  outW: number;
}

/** All adjustment parameters, gathered once per preview pass (no `this`). */
export interface AdjustSettings {
  levels: Record<'rgb' | 'r' | 'g' | 'b', LevelCh>;
  curveLuts: Record<'rgb' | 'r' | 'g' | 'b', number[] | null>;
  brightness: number; // -100..100
  contrast: number; // -100..100
  shadows: number; // -100..100
  highlights: number; // -100..100
  hue: number; // degrees
  sat: number; // -100..100
  bright: number; // -100..100
}

const isIdentityLevel = (L: LevelCh): boolean =>
  L.inB === 0 && L.inW === 255 && L.gamma === 1 && L.outB === 0 && L.outW === 255;

/**
 * Apply the full adjust pipeline (Levels → Curves → Brightness/Contrast →
 * Shadows/Highlights → HSB) to a single colour. Pure; preserves alpha.
 * Behaviour is identical to the original EditorComponent method.
 */
export function adjustPixel(hex: string, s: AdjustSettings): string {
  let [r, g, b] = hexToRgb(hex);
  const a = colorAlpha(hex);

  // 1) Levels — composite (rgb) then per-channel remap with gamma.
  const remap = (vv: number, L: LevelCh) => {
    const n = Math.pow(clamp((vv - L.inB) / Math.max(1, L.inW - L.inB), 0, 1), 1 / L.gamma);
    return L.outB + n * (L.outW - L.outB);
  };
  const rgbL = s.levels.rgb;
  if (!isIdentityLevel(rgbL)) {
    r = remap(r, rgbL); g = remap(g, rgbL); b = remap(b, rgbL);
  }
  if (!isIdentityLevel(s.levels.r)) r = remap(r, s.levels.r);
  if (!isIdentityLevel(s.levels.g)) g = remap(g, s.levels.g);
  if (!isIdentityLevel(s.levels.b)) b = remap(b, s.levels.b);

  // 1.5) Curves — composite (rgb) then per-channel LUT remap.
  const cl = s.curveLuts;
  if (cl.rgb || cl.r || cl.g || cl.b) {
    const ap = (v: number, lut: number[] | null) => (lut ? lut[clamp(Math.round(v), 0, 255)] : v);
    if (cl.rgb) { r = ap(r, cl.rgb); g = ap(g, cl.rgb); b = ap(b, cl.rgb); }
    r = ap(r, cl.r); g = ap(g, cl.g); b = ap(b, cl.b);
  }

  // 2) Brightness / Contrast.
  if (s.brightness || s.contrast) {
    const br = (s.brightness / 100) * 127;
    const c = (s.contrast / 100) * 255;
    const f = (259 * (c + 255)) / (255 * (259 - c));
    const bc = (vv: number) => f * (vv + br - 128) + 128;
    r = bc(r); g = bc(g); b = bc(b);
  }

  // 3) Shadows / Highlights — luminance-masked gain (PS sign convention).
  if (s.shadows || s.highlights) {
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const sMask = clamp(1 - L * 2, 0, 1);
    const hMask = clamp(L * 2 - 1, 0, 1);
    const gain = 1 + (s.shadows / 100) * sMask - (s.highlights / 100) * hMask;
    r *= gain; g *= gain; b *= gain;
  }

  // 4) HSB (hue / saturation / brightness).
  if (s.hue || s.sat || s.bright) {
    let [h, sat, v] = rgbToHsv(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
    h = (h + s.hue + 360) % 360;
    sat = clamp(sat * (1 + s.sat / 100), 0, 1);
    v = clamp(v * (1 + s.bright / 100), 0, 1);
    [r, g, b] = hsvToRgb(h, sat, v);
  }

  return withAlpha(rgbToHex(r, g, b), a);
}
