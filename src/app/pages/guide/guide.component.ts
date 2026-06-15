import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Shortcut {
  keys: string;
  action: string;
}

@Component({
  selector: 'app-guide',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './guide.component.html',
  styleUrl: './guide.component.scss',
})
export class GuideComponent {
  constructor(@Inject(DOCUMENT) private doc: Document) {}

  /** Scroll to a section without triggering router navigation/scroll reset. */
  jumpTo(event: Event, id: string): void {
    event.preventDefault();
    this.doc.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Table-of-contents entries (anchor id + label). */
  readonly toc = [
    { id: 'start', label: 'Getting started' },
    { id: 'interface', label: 'Interface & panels' },
    { id: 'tools', label: 'Tools' },
    { id: 'drawing', label: 'Drawing & dithering' },
    { id: 'color', label: 'Color & palette' },
    { id: 'layers', label: 'Layers' },
    { id: 'animation', label: 'Animation & timeline' },
    { id: 'import', label: 'Import & convert' },
    { id: 'tilemap', label: 'Tilemap' },
    { id: 'export', label: 'Export' },
    { id: 'projects', label: 'Projects' },
    { id: 'shortcuts', label: 'Keyboard shortcuts' },
  ];

  readonly tools = [
    { key: 'P', name: 'Pen', desc: 'Draw single pixels with the primary color.' },
    { key: 'E', name: 'Eraser', desc: 'Erase pixels back to transparent.' },
    { key: 'B', name: 'Fill', desc: 'Flood-fill a connected area.' },
    { key: 'D', name: 'Gradient', desc: 'Drag primary→secondary; linear/radial with Bayer dither.' },
    { key: 'A', name: 'Shade', desc: 'Drag to darken (Alt: lighten) along the palette ramp.' },
    { key: 'K', name: 'Spray', desc: 'Scatter palette shades around the primary in soft clumps — fast mottled water, light & foam. Size = radius; Density & Scatter (clump size) in tool options; make a selection to confine it.' },
    { key: 'I', name: 'Picker', desc: 'Sample a color from the canvas.' },
    { key: 'L', name: 'Line', desc: 'Draw a straight line.' },
    { key: 'R', name: 'Rectangle', desc: 'Draw a rectangle outline.' },
    { key: 'O', name: 'Ellipse', desc: 'Draw an ellipse / circle.' },
    { key: 'S', name: 'Select', desc: 'Select a rectangular region.' },
    { key: 'W', name: 'Magic wand', desc: 'Select a contiguous same-color area on the active layer.' },
    { key: 'Q', name: 'Lasso', desc: 'Freehand-select any shape by drawing around it.' },
    { key: 'M', name: 'Move', desc: 'Move the current selection.' },
    { key: 'T', name: 'Transform', desc: 'Scale, rotate and move the selection with handles.' },
  ];

  readonly shortcuts: Shortcut[] = [
    { keys: 'Ctrl + K', action: 'Command palette (search every action)' },
    { keys: 'P E B D A K I L R O S W Q M T', action: 'Pick a tool' },
    { keys: 'Shift / Alt + Wand·Lasso', action: 'Add to / subtract from selection' },
    { keys: 'T then drag handles', action: 'Transform: scale / rotate / move' },
    { keys: 'Enter / Esc', action: 'Commit / cancel a transform' },
    { keys: 'Space (hold)', action: 'Pan the canvas' },
    { keys: 'Ctrl + Z', action: 'Undo' },
    { keys: 'Ctrl + Y / Ctrl + Shift + Z', action: 'Redo' },
    { keys: 'Ctrl + C / X / V', action: 'Copy / cut / paste selection' },
    { keys: 'Ctrl + J / Ctrl + Shift + J', action: 'Selection → new layer (copy / cut)' },
    { keys: 'Delete', action: 'Cut selection' },
    { keys: '← ↑ → ↓', action: 'Nudge selection / layer' },
    { keys: 'Enter', action: 'Play / pause animation' },
    { keys: ', / .', action: 'Previous / next frame' },
    { keys: 'X', action: 'Swap primary / secondary color' },
    { keys: 'G', action: 'Toggle grid' },
    { keys: 'Shift + M', action: 'Toggle symmetry (Mirror X)' },
    { keys: 'Shift + H / Shift + V', action: 'Flip horizontal / vertical' },
    { keys: '[ / ]', action: 'Brush size − / +' },
    { keys: '+ / −', action: 'Zoom in / out' },
    { keys: 'Ctrl + scroll', action: 'Zoom the canvas' },
  ];
}
