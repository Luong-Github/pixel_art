/**
 * Palette quantization extracted from EditorComponent for testing. Pure; no `this`.
 * Behaviour identical to the original methods.
 */

/** Index of the nearest palette colour (luma-weighted squared distance). */
export function nearestPaletteIndex(r: number, g: number, b: number, palette: number[][]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  palette.forEach((color, index) => {
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

export function nearestPaletteColor(r: number, g: number, b: number, palette: number[][]): number[] {
  return palette[nearestPaletteIndex(r, g, b, palette)];
}

/** Build a `size`-colour palette from RGBA pixel data (bucket + k-means refine). */
export function buildPalette(data: Uint8ClampedArray, size: number): number[][] {
  const buckets = new Map<string, { rgb: number[]; count: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 20) {
      continue;
    }
    const r = Math.round(data[i] / 8) * 8;
    const g = Math.round(data[i + 1] / 8) * 8;
    const b = Math.round(data[i + 2] / 8) * 8;
    const key = `${r},${g},${b}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
    } else {
      buckets.set(key, { rgb: [r, g, b], count: 1 });
    }
  }
  let colors = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(size * 8, size))
    .map((item) => ({ rgb: item.rgb, cluster: 0 }));
  if (colors.length <= size) {
    return colors.map((item) => item.rgb);
  }
  let centers = colors
    .filter((_, index) => index % Math.max(1, Math.floor(colors.length / size)) === 0)
    .slice(0, size)
    .map((item) => [...item.rgb]);
  for (let iteration = 0; iteration < 8; iteration += 1) {
    colors = colors.map((color) => ({
      ...color,
      cluster: nearestPaletteIndex(color.rgb[0], color.rgb[1], color.rgb[2], centers),
    }));
    centers = centers.map((center, index) => {
      const group = colors.filter((color) => color.cluster === index);
      if (!group.length) {
        return center;
      }
      return [0, 1, 2].map((channel) =>
        Math.round(group.reduce((sum, color) => sum + color.rgb[channel], 0) / group.length),
      );
    });
  }
  return centers;
}
