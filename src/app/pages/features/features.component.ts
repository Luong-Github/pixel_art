import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface FeatureGroup {
  area: string;
  items: string[];
}

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './features.component.html',
  styleUrl: './features.component.scss',
})
export class FeaturesComponent {
  readonly groups: FeatureGroup[] = [
    {
      area: 'Drawing',
      items: ['Pen, eraser, fill, picker', 'Line, rectangle, ellipse', 'Select & move', 'Mirror-X drawing'],
    },
    {
      area: 'Animation',
      items: ['Frame timeline', 'Layer timeline', 'Live playback', 'Per-frame duration', 'Onion skin'],
    },
    {
      area: 'Canvas',
      items: ['Adjustable grid', 'Zoom & pan', 'Display preview', 'Resizable workspace panes'],
    },
    {
      area: 'Color',
      items: ['Primary & secondary colors', 'Palette swatches', 'Color swap', 'On-screen eyedropper'],
    },
    {
      area: 'Image convert',
      items: ['Resize & fit modes', 'Palette reduction', 'Error-diffusion dither', 'Sharpen & contrast'],
    },
    {
      area: 'Export',
      items: ['PNG at 1x', 'PNG at zoom scale', '.pixelart.json project files', 'Import existing projects'],
    },
  ];

  readonly shortcuts = [
    ['P', 'Pen'], ['E', 'Eraser'], ['B', 'Fill'], ['I', 'Picker'],
    ['L', 'Line'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['S', 'Select'],
    ['M', 'Move'], ['Space', 'Pan'], ['Ctrl+Z', 'Undo'], ['Ctrl+Y', 'Redo'],
  ];
}
