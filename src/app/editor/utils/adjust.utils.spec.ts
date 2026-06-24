import { adjustPixel, AdjustSettings, LevelCh } from './adjust.utils';

const idLevel = (): LevelCh => ({ inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 });

function neutral(): AdjustSettings {
  return {
    levels: { rgb: idLevel(), r: idLevel(), g: idLevel(), b: idLevel() },
    curveLuts: { rgb: null, r: null, g: null, b: null },
    brightness: 0,
    contrast: 0,
    shadows: 0,
    highlights: 0,
    hue: 0,
    sat: 0,
    bright: 0,
  };
}

describe('adjust.utils adjustPixel', () => {
  it('neutral settings leave the colour unchanged', () => {
    expect(adjustPixel('#ff8000', neutral())).toBe('#ff8000');
  });

  it('preserves alpha (8-digit hex)', () => {
    expect(adjustPixel('#3366cc80', neutral())).toBe('#3366cc80');
  });

  it('brightness +100 lifts a mid grey to white', () => {
    expect(adjustPixel('#808080', { ...neutral(), brightness: 100 })).toBe('#ffffff');
  });

  it('brightness -100 crushes a mid grey toward black', () => {
    expect(adjustPixel('#808080', { ...neutral(), brightness: -100 })).toBe('#010101');
  });

  it('levels black-point lift maps the input black to 0', () => {
    const s = neutral();
    s.levels.rgb = { inB: 128, inW: 255, gamma: 1, outB: 0, outW: 255 };
    expect(adjustPixel('#808080', s)).toBe('#000000');
  });

  it('hue +120° rotates red to green', () => {
    expect(adjustPixel('#ff0000', { ...neutral(), hue: 120 })).toBe('#00ff00');
  });

  it('an identity curve LUT leaves the colour unchanged', () => {
    const idLut = Array.from({ length: 256 }, (_, i) => i);
    const s = neutral();
    s.curveLuts = { rgb: idLut, r: null, g: null, b: null };
    expect(adjustPixel('#1234ab', s)).toBe('#1234ab');
  });
});
