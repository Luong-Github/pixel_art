/** Site-wide constants used for SEO, Open Graph and structured data. */
export const SITE = {
  name: 'Pixel Art Studio',
  shortName: 'Pixel Studio',
  /** Public base URL — update to the real domain on deploy. */
  url: 'https://pixelartstudio.app',
  tagline: 'Draw, animate and export pixel art in your browser',
  description:
    'Pixel Art Studio is a free browser-based pixel art editor for drawing sprites, ' +
    'building frame-by-frame animations, converting images to pixel art, and exporting ' +
    'PNGs or project files — no install required.',
  twitter: '@pixelartstudio',
  ogImage: '/assets/idle-preset.webp',
  locale: 'en_US',
} as const;

export interface PageSeo {
  title: string;
  description?: string;
  /** Route path without leading slash, e.g. 'features'. Empty string = home. */
  path?: string;
  image?: string;
  /** Override the JSON-LD structured data for this page. */
  jsonLd?: Record<string, unknown>;
  /** When true, ask crawlers not to index (e.g. 404). */
  noIndex?: boolean;
}
