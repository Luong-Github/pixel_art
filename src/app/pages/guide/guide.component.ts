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
    { id: 'export', label: 'Export' },
    { id: 'projects', label: 'Projects' },
    { id: 'shortcuts', label: 'Keyboard shortcuts' },
  ];

  readonly tools = [
    { key: 'P', name: 'Pen', desc: 'Draw single pixels with the primary color.' },
    { key: 'E', name: 'Eraser', desc: 'Erase pixels back to transparent.' },
    { key: 'B', name: 'Fill', desc: 'Flood-fill a connected area.' },
    { key: 'I', name: 'Picker', desc: 'Sample a color from the canvas.' },
    { key: 'L', name: 'Line', desc: 'Draw a straight line.' },
    { key: 'R', name: 'Rectangle', desc: 'Draw a rectangle outline.' },
    { key: 'O', name: 'Ellipse', desc: 'Draw an ellipse / circle.' },
    { key: 'S', name: 'Select', desc: 'Select a rectangular region.' },
    { key: 'M', name: 'Move', desc: 'Move the current selection.' },
  ];

  readonly shortcuts: Shortcut[] = [
    { keys: 'P E B I L R O S M', action: 'Pick a tool' },
    { keys: 'Space (hold)', action: 'Pan the canvas' },
    { keys: 'Ctrl + Z', action: 'Undo' },
    { keys: 'Ctrl + Y / Ctrl + Shift + Z', action: 'Redo' },
    { keys: 'Ctrl + C / X / V', action: 'Copy / cut / paste selection' },
    { keys: 'Delete', action: 'Cut selection' },
    { keys: '← ↑ → ↓', action: 'Nudge selection / layer' },
    { keys: 'Enter', action: 'Play / pause animation' },
    { keys: ', / .', action: 'Previous / next frame' },
    { keys: 'X', action: 'Swap primary / secondary color' },
    { keys: 'G', action: 'Toggle grid' },
    { keys: 'Shift + M', action: 'Toggle mirror-X' },
    { keys: 'Shift + H / Shift + V', action: 'Flip horizontal / vertical' },
    { keys: '[ / ]', action: 'Brush size − / +' },
    { keys: '+ / −', action: 'Zoom in / out' },
    { keys: 'Ctrl + scroll', action: 'Zoom the canvas' },
  ];
}
