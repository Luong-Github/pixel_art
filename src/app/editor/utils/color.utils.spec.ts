import {
  clamp, hexToRgb, rgbToHex, colorAlpha, withAlpha, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb,
} from './color.utils';

describe('color.utils', () => {
  describe('hexToRgb', () => {
    it('parses #rrggbb', () => expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]));
    it('expands #rgb', () => expect(hexToRgb('#f80')).toEqual([255, 136, 0]));
    it('ignores alpha in #rrggbbaa', () => expect(hexToRgb('#ff800080')).toEqual([255, 128, 0]));
  });

  describe('rgbToHex', () => {
    it('formats, rounds and clamps', () => {
      expect(rgbToHex(255, 128, 0)).toBe('#ff8000');
      expect(rgbToHex(300, -5, 127.6)).toBe('#ff0080');
    });
  });

  describe('colorAlpha', () => {
    it('is 255 for 6-digit hex', () => expect(colorAlpha('#ff8000')).toBe(255));
    it('reads alpha from 8-digit hex', () => expect(colorAlpha('#ff800080')).toBe(128));
  });

  describe('withAlpha', () => {
    it('drops alpha when >= 255', () => expect(withAlpha('#ff8000', 255)).toBe('#ff8000'));
    it('appends aa when < 255', () => expect(withAlpha('#ff8000', 128)).toBe('#ff800080'));
    it('clamps + rounds alpha', () => expect(withAlpha('#ff8000', 300)).toBe('#ff8000'));
  });

  const SAMPLES: [number, number, number][] = [
    [255, 128, 0], [10, 200, 90], [0, 0, 0], [255, 255, 255], [123, 45, 200],
  ];

  describe('hsv round-trip', () => {
    it('rgb → hsv → rgb is stable', () => {
      for (const [r, g, b] of SAMPLES) {
        const [r2, g2, b2] = hsvToRgb(...rgbToHsv(r, g, b));
        expect(r2).toBeCloseTo(r);
        expect(g2).toBeCloseTo(g);
        expect(b2).toBeCloseTo(b);
      }
    });
  });

  describe('hsl round-trip', () => {
    it('rgb → hsl → rgb is stable', () => {
      for (const [r, g, b] of SAMPLES) {
        const [r2, g2, b2] = hslToRgb(...rgbToHsl(r, g, b));
        expect(r2).toBeCloseTo(r);
        expect(g2).toBeCloseTo(g);
        expect(b2).toBeCloseTo(b);
      }
    });
  });

  describe('clamp', () => {
    it('clamps to range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-1, 0, 10)).toBe(0);
      expect(clamp(99, 0, 10)).toBe(10);
    });
  });
});
