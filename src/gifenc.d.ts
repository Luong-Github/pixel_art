/** Minimal ambient types for the `gifenc` package (ships no types). */
declare module 'gifenc' {
  export type Palette = number[][];

  export interface WriteFrameOptions {
    palette?: Palette;
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    repeat?: number;
    first?: boolean;
  }

  export interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array | number[],
      width: number,
      height: number,
      options?: WriteFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    buffer: ArrayBuffer;
  }

  export function GIFEncoder(options?: { auto?: boolean }): GIFEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: string; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: string,
  ): Uint8Array;
}
