/** Built-in pixel-art palettes (hex strings). */
export interface NamedPalette {
  id: string;
  name: string;
  colors: string[];
}

export const BUILTIN_PALETTES: NamedPalette[] = [
  {
    id: 'pico8',
    name: 'PICO-8',
    colors: [
      '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f',
      '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436',
      '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ],
  },
  {
    id: 'gameboy',
    name: 'Game Boy',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
  {
    id: 'nes',
    name: 'NES',
    colors: [
      '#7c7c7c', '#0000fc', '#0000bc', '#4428bc', '#940084', '#a80020',
      '#a81000', '#881400', '#503000', '#007800', '#006800', '#005800',
      '#004058', '#000000', '#bcbcbc', '#0078f8', '#0058f8', '#6844fc',
      '#d800cc', '#e40058', '#f83800', '#e45c10', '#ac7c00', '#00b800',
      '#00a800', '#00a844', '#008888', '#f8f8f8', '#3cbcfc', '#6888fc',
      '#9878f8', '#f878f8', '#f85898', '#f87858', '#fca044', '#f8b800',
      '#b8f818', '#58d854', '#58f898', '#00e8d8', '#787878', '#fcfcfc',
      '#a4e4fc', '#b8b8f8', '#d8b8f8', '#f8b8f8', '#f8a4c0', '#f0d0b0',
      '#fce0a8', '#f8d878', '#d8f878', '#b8f8b8', '#b8f8d8', '#00fcfc',
    ],
  },
  {
    id: 'db16',
    name: 'DawnBringer 16',
    colors: [
      '#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524',
      '#d04648', '#757161', '#597dce', '#d27d2c', '#8595a1', '#6daa2c',
      '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
    ],
  },
  {
    id: 'shadowramp',
    name: 'Shadow Ramp',
    // Light → dark, hue-shifting warm highlights toward cool/purple shadows
    // (classic shading practice). Click left→right to ramp from light to dark.
    colors: [
      '#fff6e0', '#ffe9c0', '#ffd9a0', '#f0b988', '#d99877', '#b87a6e',
      '#8f5e6b', '#6a4663', '#4a3357', '#2e2140', '#1a1530', '#ffffff',
    ],
  },
  {
    id: 'endesga32',
    name: 'ENDESGA 32',
    colors: [
      '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39',
      '#3e2731', '#a22633', '#e43b44', '#f77622', '#feae34', '#fee761',
      '#63c74d', '#3e8948', '#265c42', '#193c3e', '#124e89', '#0099db',
      '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
      '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a',
      '#e8b796', '#c28569',
    ],
  },

  // ---- Purpose palettes: each spans deep shadow → bright highlight for strong
  // contrast, with hue-shifted ramps (cooler/darker shadows, warmer/lighter tips).
  {
    id: 'water',
    name: 'Water',
    // Deep blue → cyan → foam, plus a teal accent for reflective glints.
    colors: [
      '#06182e', '#0d2b50', '#164a78', '#216f9e', '#2f93c4', '#54b3e0',
      '#86d2f1', '#bfecff', '#eafaff', '#ffffff', '#1f9e8d', '#0a3f3a',
    ],
  },
  {
    id: 'glass',
    name: 'Glass (paint at low opacity)',
    // Built for see-through: paint on a layer (or brush) with reduced opacity so
    // the background reads through. Pale blue tints + bright edge highlights, a
    // thin dark rim, and stained-glass tints (green/violet). Order: highlight first.
    colors: [
      '#ffffff', '#eaf7ff', '#c7e8fb', '#9bd3f0', '#6fb9e2', '#3f93c4',
      '#bdeed6', '#7fdcc0', '#d9c2f0', '#f6c9e0', '#243447', '#0e1a28',
    ],
  },
  {
    id: 'tech',
    name: 'Tech / Devices',
    // Cool brushed-steel grays (near-black → white) + emissive LED/warning accents.
    colors: [
      '#0c0f14', '#171d26', '#27303b', '#3b4654', '#52606f', '#717f8e',
      '#9aa7b4', '#c6d0d9', '#eef3f7', '#ffffff', '#00e5d0', '#36d399',
      '#ff5d5d', '#ffd23f',
    ],
  },
  {
    id: 'nature',
    name: 'Nature',
    // Foliage greens (blue-green shade → yellow-green tip), bark/earth browns,
    // and sky/water + flower accents for focal pops.
    colors: [
      '#16240f', '#26401a', '#3a6326', '#4f7d2a', '#6f9a32', '#8cae3e',
      '#b5d35a', '#e6e6a3', '#2c1a10', '#4a2f1c', '#6e4a2c', '#9a6f3f',
      '#c39a5e', '#7fb4d8', '#3f7fbf', '#e36a8a',
    ],
  },
];

export const PALETTE_STORAGE_KEY = 'pixelart.palettes.v1';
