import { nearestPaletteIndex, nearestPaletteColor, buildPalette } from './quantize.utils';

function rgba(pixels: number[][]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => {
    d[i * 4] = p[0];
    d[i * 4 + 1] = p[1];
    d[i * 4 + 2] = p[2];
    d[i * 4 + 3] = p[3] ?? 255;
  });
  return d;
}

describe('quantize.utils', () => {
  const palette = [[0, 0, 0], [255, 255, 255], [255, 0, 0]];

  describe('nearestPaletteIndex', () => {
    it('picks the closest colour', () => {
      expect(nearestPaletteIndex(10, 10, 10, palette)).toBe(0);
      expect(nearestPaletteIndex(240, 240, 240, palette)).toBe(1);
      expect(nearestPaletteIndex(220, 10, 10, palette)).toBe(2);
    });
  });

  it('nearestPaletteColor returns the rgb triple', () => {
    expect(nearestPaletteColor(240, 240, 240, palette)).toEqual([255, 255, 255]);
  });

  describe('buildPalette', () => {
    it('returns the distinct colours when fewer than size', () => {
      const pal = buildPalette(rgba([[0, 0, 0], [255, 255, 255]]), 8);
      expect(pal.length).toBe(2);
    });

    it('skips transparent pixels', () => {
      const pal = buildPalette(rgba([[0, 0, 0, 0], [255, 255, 255, 255]]), 8);
      expect(pal.length).toBe(1);
    });

    it('reduces to at most `size` colours', () => {
      const many: number[][] = [];
      for (let i = 0; i < 40; i += 1) many.push([i * 6, 255 - i * 6, (i * 13) % 256]);
      expect(buildPalette(rgba(many), 8).length).toBeLessThanOrEqual(8);
    });
  });
});
