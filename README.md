# Pixel Art Studio

A browser-based pixel art editor built with Angular. Pixel Art Studio gives you a compact creative workspace for drawing sprites, building frame animations, converting imported images into pixel art, and exporting finished work as PNG or project files.

![Angular](https://img.shields.io/badge/Angular-17.3-dd0031?style=for-the-badge&logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![Pixel Art](https://img.shields.io/badge/Pixel%20Art-Editor-1f8a7c?style=for-the-badge)

## Product Website

Pixel Art Studio ships as a full product website with a marketing front end wrapped around the
editor. The site is router-driven, and the public marketing pages are **prerendered to static
HTML** (`@angular/ssr`) so they are fully crawlable, while the heavy editor stays a client-only,
lazy-loaded app.

### Routes

| Path | Page |
| --- | --- |
| `/` | Landing (hero, feature highlights, how-it-works, CTA) |
| `/features` | Capability grid + keyboard shortcuts |
| `/pricing` | Free / Pro / Team plans (UI only) |
| `/about` | Product story |
| `/blog`, `/blog/:slug` | Tutorials & tips (data-driven) |
| `/faq` | Accordion of common questions |
| `/contact` | Contact form (opens mail client) |
| `/editor` | The full pixel editor (client-only, full screen) |
| `*` | 404 (keeps site header/footer) |

### SEO

- Per-route `<title>`, meta description, canonical link, Open Graph + Twitter cards, and JSON-LD,
  driven centrally from route `data` by `SeoService` (blog posts set their own per-post meta).
- Static `robots.txt` and `sitemap.xml` served from the site root.
- Marketing routes are listed in `prerender-routes.txt` and emitted as static HTML at build time;
  `/editor` is intentionally excluded from prerendering.

### Editor workspace

The editor uses a **dockable, floating-panel layout** (Angular CDK). Every panel (Tools, Color,
Display, Image Convert, Canvas, Transform, Timeline) can be dragged between the left / right /
bottom dock zones, torn off into a free-floating window, resized, re-docked, collapsed or closed.
The arrangement is persisted to `localStorage`, with a **Reset Layout** button and a **Panels**
menu in the toolbar. The interface uses a dark, professional theme.

## Deployment (Vercel)

The app deploys to Vercel as a **static site** — no server required. `vercel.json` sets the build
command, points the output at `dist/pixel-art-studio/browser`, and adds an SPA fallback so deep
links like `/editor` resolve to the client app while prerendered routes and assets are served
directly.

```bash
# Option A — Git integration: push to GitHub, then import the repo at vercel.com
# Option B — CLI:
npm i -g vercel
vercel --prod
```

After the first deploy, update the production domain in `src/app/core/seo/seo.data.ts`
(`SITE.url`), `src/robots.txt` and `src/sitemap.xml` so canonical/SEO URLs are correct.

## Overview

Pixel Art Studio is designed like a focused production tool:

- **Left rail:** drawing tools and color palette
- **Center workspace:** pixel canvas, panning, zooming, tabs, and status
- **Bottom timeline:** layers, frames, visibility, playback, and duration
- **Right inspector:** preview, image conversion, canvas settings, and transforms

It also includes built-in animated examples, including a layered ancient tree preset with wind-driven foliage motion.

## Highlights

| Area | Capabilities |
| --- | --- |
| Drawing | Pen, eraser, fill, picker, line, rectangle, ellipse, select, move |
| Animation | Frame timeline, layer timeline, playback, frame duration, onion skin |
| Canvas | Grid, zoom, display preview, mirror-X drawing, panning |
| Color | Primary/secondary colors, palette swatches, color swap, screen picker |
| Import | Image resize, fit mode, palette reduction, dithering, sharpen, contrast |
| Export | PNG 1x, PNG at zoom scale, `.pixelart.json` project files |
| Presets | Animated idle character and animated ancient tree example |

## Screens and Presets

### Tree Example

`Tree Example` generates a multi-layer animated tree with:

- clustered leaf canopy
- selected foliage and branch-tip wind motion
- cyan rim lighting
- twisted trunk and exposed roots
- rocks and cast shadow
- separate editable layers

### Idle Example

`Idle Example` loads an animated character preset from bundled frame assets.

## Quick Start

```bash
npm install
npm run start
```

Open the app:

```text
http://localhost:4200/
```

Build for production:

```bash
npm run build
```

Output is written to:

```text
dist/pixel-art-studio
```

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `P` | Pen |
| `E` | Eraser |
| `B` | Fill |
| `I` | Picker |
| `L` | Line |
| `R` | Rectangle |
| `O` | Ellipse |
| `S` | Select |
| `M` | Move |
| `Space` | Pan canvas |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` | Redo |
| `Ctrl + C` | Copy selection |
| `Ctrl + X` / `Delete` | Cut selection |
| `Ctrl + V` | Paste selection |

## Workflow

1. Choose a drawing tool from the left rail or use a shortcut.
2. Pick primary and secondary colors.
3. Draw on the center canvas with grid, zoom, and mirror tools as needed.
4. Add layers and frames in the timeline.
5. Preview animation with `Play`.
6. Export as `PNG 1x`, `PNG Zoom`, or `Export Project`.

## Image Conversion

The Image Convert panel helps turn regular images into pixel art.

| Control | Purpose |
| --- | --- |
| `Long side` | Sets the target size for the longest image edge |
| `Palette` | Controls the number of reduced colors |
| `Fit` | Uses contain, cover, or stretch behavior |
| `Contrast` | Adjusts tonal strength before conversion |
| `Sharpen` | Adds edge clarity before sampling |
| `Resize canvas` | Matches the canvas to the imported image |
| `Dither` | Uses error diffusion for smoother color transitions |

## Project Files

`Export Project` saves the complete editor state:

- workspaces
- frames
- layers
- palette
- active colors
- canvas settings
- import settings
- mirror setting

Use `Import Project` to reload a `.pixelart.json` file.

## Development

This project is built as an Angular standalone app using the router and `@angular/ssr` prerendering.

```text
src/app/app.component.ts          root shell (router-outlet + skip link)
src/app/app.routes.ts             route table (site layout + lazy editor)
src/app/app.config.ts             router + client hydration providers
src/app/core/seo/                 SeoService + site constants (title/meta/OG/JSON-LD)
src/app/layout/                   site header, footer, and marketing layout shell
src/app/pages/                    landing, features, pricing, about, blog, faq, contact, 404
src/app/editor/editor.component.* the pixel editor (state, drawing, import/export, presets)
src/assets/idle-frames            bundled idle animation frames
src/robots.txt, src/sitemap.xml   SEO static files (served from root)
prerender-routes.txt              marketing routes to prerender (editor excluded)
```

### Commands

```bash
npm run start                      # dev server at http://localhost:4200/
npm run build                      # production build + prerender marketing routes
npm run serve:ssr:pixel-art-studio # run the built SSR server (node)
```

## Build Note

The production build currently reports a component stylesheet budget warning because `editor.component.scss` is larger than Angular's default 8 kB warning budget. The build still completes successfully and remains below the configured error budget.
