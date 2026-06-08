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
];

export const PALETTE_STORAGE_KEY = 'pixelart.palettes.v1';
