import { buildCurveLut } from './curve.utils';

describe('curve.utils buildCurveLut', () => {
  it('identity curve maps x → x', () => {
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    expect(lut.length).toBe(256);
    expect(lut[0]).toBe(0);
    expect(lut[128]).toBe(128);
    expect(lut[255]).toBe(255);
  });

  it('a single point fills the LUT flat', () => {
    const lut = buildCurveLut([{ x: 100, y: 200 }]);
    expect(lut.every((v) => v === 200)).toBeTrue();
  });

  it('clamps to endpoint y before the first / after the last point', () => {
    const lut = buildCurveLut([{ x: 50, y: 30 }, { x: 200, y: 240 }]);
    expect(lut[0]).toBe(30);
    expect(lut[255]).toBe(240);
  });

  it('stays monotonic for increasing points (no overshoot)', () => {
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 64, y: 10 }, { x: 192, y: 245 }, { x: 255, y: 255 }]);
    for (let i = 1; i < 256; i += 1) {
      expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
  });

  it('keeps every entry within 0..255', () => {
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 128, y: 255 }, { x: 255, y: 0 }]);
    expect(lut.every((v) => v >= 0 && v <= 255)).toBeTrue();
  });
});
