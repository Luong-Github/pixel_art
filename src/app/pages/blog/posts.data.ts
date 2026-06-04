export interface BlogPost {
  slug: string;
  title: string;
  date: string; // ISO
  readMins: number;
  excerpt: string;
  tags: string[];
  /** Simple HTML body (trusted, authored content). */
  body: string;
}

export const POSTS: BlogPost[] = [
  {
    slug: 'getting-started-with-pixel-art',
    title: 'Getting started with pixel art in the browser',
    date: '2026-05-20',
    readMins: 5,
    excerpt:
      'A quick tour of the studio: tools, the canvas, and how to draw your first sprite in minutes.',
    tags: ['Tutorial', 'Basics'],
    body: `
      <p>Pixel art is one of the most approachable art forms — you only need a grid and a few colors. Pixel Art Studio gives you that grid in a browser tab, plus the tools to take a sprite all the way to export.</p>
      <h2>1. Pick a tool</h2>
      <p>The left rail holds your tools: pen, eraser, fill, picker, line, rectangle, ellipse, select and move. Each has a keyboard shortcut (press <strong>P</strong> for pen, <strong>E</strong> for eraser) so you can stay fast.</p>
      <h2>2. Choose colors</h2>
      <p>Set a primary and secondary color and build up a palette of swatches. The on-screen eyedropper lets you sample any color you can see.</p>
      <h2>3. Draw on the canvas</h2>
      <p>Zoom and pan freely, toggle the grid, and turn on mirror-X to draw symmetric sprites in half the time.</p>
      <h2>4. Export</h2>
      <p>When you're happy, export a PNG at 1x or scaled to your zoom, or save a <code>.pixelart.json</code> project to keep iterating later.</p>
    `,
  },
  {
    slug: 'animating-sprites-frame-by-frame',
    title: 'Animating sprites frame by frame',
    date: '2026-05-27',
    readMins: 6,
    excerpt:
      'Use the frame timeline, onion skin and per-frame duration to bring a static sprite to life.',
    tags: ['Animation', 'Tutorial'],
    body: `
      <p>Animation is just a sequence of frames shown quickly. The bottom timeline in Pixel Art Studio makes that loop easy to build and preview.</p>
      <h2>Frames and layers</h2>
      <p>Add frames along the timeline, and within each frame stack layers with their own visibility and opacity. This keeps backgrounds, characters and effects separated and editable.</p>
      <h2>Onion skin</h2>
      <p>Turn on onion skin to see a ghost of the neighbouring frames while you draw — invaluable for keeping motion smooth.</p>
      <h2>Timing and playback</h2>
      <p>Give each frame its own duration to control pacing, then hit <strong>Play</strong> to watch the animation loop right in the editor.</p>
    `,
  },
  {
    slug: 'turn-photos-into-pixel-art',
    title: 'Turn photos into pixel art with image conversion',
    date: '2026-06-02',
    readMins: 4,
    excerpt:
      'Import any image and dial in palette size, dithering and contrast to get a clean pixel result.',
    tags: ['Image convert', 'Tips'],
    body: `
      <p>Sometimes the fastest way to start is from a reference image. The Image Convert panel turns regular pictures into pixel art you can refine by hand.</p>
      <h2>Set the size</h2>
      <p>The <em>Long side</em> control sets the target resolution for the longest edge, and <em>Fit</em> chooses contain, cover or stretch behaviour.</p>
      <h2>Reduce the palette</h2>
      <p>Lower the <em>Palette</em> count for that classic limited-color look. Enable <em>Dither</em> for smoother gradients via error diffusion.</p>
      <h2>Tune the source</h2>
      <p>Adjust <em>Contrast</em> and <em>Sharpen</em> before sampling to keep edges crisp, then resize the canvas to match and start cleaning up pixels.</p>
    `,
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}
