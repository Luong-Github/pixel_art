import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
})
export class LandingComponent {
  readonly highlights = [
    {
      icon: '✏️',
      title: 'Full drawing toolkit',
      text: 'Pen, eraser, fill, picker, line, rectangle, ellipse, select and move — with mirror-X drawing.',
    },
    {
      icon: '🎞️',
      title: 'Frame animation',
      text: 'Build animations on a frame timeline with onion skin, per-frame duration and live playback.',
    },
    {
      icon: '🧅',
      title: 'Layers',
      text: 'Stack editable layers with visibility and opacity, organised per frame.',
    },
    {
      icon: '🖼️',
      title: 'Image to pixel art',
      text: 'Import any image and reduce it to a palette with dithering, contrast and sharpen controls.',
    },
    {
      icon: '🎨',
      title: 'Color tools',
      text: 'Primary/secondary swatches, palette management, color swap and an on-screen picker.',
    },
    {
      icon: '📦',
      title: 'Export anywhere',
      text: 'Export PNG at 1x or zoom scale, or save a full .pixelart.json project to reload later.',
    },
  ];

  readonly steps = [
    { n: '01', title: 'Open the editor', text: 'Launch the studio instantly in your browser — nothing to install.' },
    { n: '02', title: 'Draw & animate', text: 'Sketch sprites, add frames and layers, and preview the motion live.' },
    { n: '03', title: 'Export & share', text: 'Download a PNG or save your project file to keep iterating.' },
  ];
}
