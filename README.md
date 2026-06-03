# Pixel Art Studio

A browser-based pixel art editor built with Angular. Pixel Art Studio gives you a compact creative workspace for drawing sprites, building frame animations, converting imported images into pixel art, and exporting finished work as PNG or project files.

![Angular](https://img.shields.io/badge/Angular-17.3-dd0031?style=for-the-badge&logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![Pixel Art](https://img.shields.io/badge/Pixel%20Art-Editor-1f8a7c?style=for-the-badge)

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

This project is built as an Angular standalone app.

```text
src/app/app.component.ts      editor state, drawing logic, import/export, presets
src/app/app.component.html    workspace layout and controls
src/app/app.component.scss    UI styling
src/assets/idle-frames        bundled idle animation frames
```

## Build Note

The production build currently reports a component stylesheet budget warning because `app.component.scss` is larger than Angular's default 8 kB warning budget. The build still completes successfully and remains below the configured error budget.
