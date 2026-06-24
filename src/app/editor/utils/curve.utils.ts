import { clamp } from './color.utils';

/**
 * Build a smooth monotone-cubic (Fritsch–Carlson / PCHIP) 256-entry lookup table
 * through the given control points. Extracted from EditorComponent for testing;
 * behaviour is identical to the original method.
 */
export function buildCurveLut(pts: { x: number; y: number }[]): number[] {
  const p = [...pts].sort((a, b) => a.x - b.x);
  const n = p.length;
  const lut = new Array(256);
  if (n === 1) {
    lut.fill(clamp(Math.round(p[0].y), 0, 255));
    return lut;
  }
  const xs = p.map((q) => q.x);
  const ys = p.map((q) => q.y);
  const dx: number[] = [], dy: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = (xs[i + 1] - xs[i]) || 1;
    dy[i] = ys[i + 1] - ys[i];
    m[i] = dy[i] / dx[i];
  }
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }
  // Fritsch–Carlson limiter keeps the spline monotone (no overshoot ringing).
  for (let i = 0; i < n - 1; i += 1) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], bb = t[i + 1] / m[i];
    const h = Math.hypot(a, bb);
    if (h > 3) { const tau = 3 / h; t[i] = tau * a * m[i]; t[i + 1] = tau * bb * m[i]; }
  }
  for (let xi = 0; xi < 256; xi += 1) {
    if (xi <= xs[0]) { lut[xi] = clamp(Math.round(ys[0]), 0, 255); continue; }
    if (xi >= xs[n - 1]) { lut[xi] = clamp(Math.round(ys[n - 1]), 0, 255); continue; }
    let s = 0;
    while (s < n - 1 && !(xi >= xs[s] && xi <= xs[s + 1])) s += 1;
    const h = dx[s], u = (xi - xs[s]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    const v = h00 * ys[s] + h10 * h * t[s] + h01 * ys[s + 1] + h11 * h * t[s + 1];
    lut[xi] = clamp(Math.round(v), 0, 255);
  }
  return lut;
}
