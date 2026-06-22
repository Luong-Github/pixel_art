import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../i18n/translate.pipe';

interface FeatureGroup {
  areaKey: string;
  itemKeys: string[];
}

@Component({
  selector: 'app-features',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './features.component.html',
  styleUrl: './features.component.scss',
})
export class FeaturesComponent {
  readonly groups: FeatureGroup[] = [
    {
      areaKey: 'features.group.drawing',
      itemKeys: [
        'features.group.drawing.item1',
        'features.group.drawing.item2',
        'features.group.drawing.item3',
        'features.group.drawing.item4',
      ],
    },
    {
      areaKey: 'features.group.animation',
      itemKeys: [
        'features.group.animation.item1',
        'features.group.animation.item2',
        'features.group.animation.item3',
        'features.group.animation.item4',
        'features.group.animation.item5',
      ],
    },
    {
      areaKey: 'features.group.canvas',
      itemKeys: [
        'features.group.canvas.item1',
        'features.group.canvas.item2',
        'features.group.canvas.item3',
        'features.group.canvas.item4',
      ],
    },
    {
      areaKey: 'features.group.color',
      itemKeys: [
        'features.group.color.item1',
        'features.group.color.item2',
        'features.group.color.item3',
        'features.group.color.item4',
      ],
    },
    {
      areaKey: 'features.group.convert',
      itemKeys: [
        'features.group.convert.item1',
        'features.group.convert.item2',
        'features.group.convert.item3',
        'features.group.convert.item4',
      ],
    },
    {
      areaKey: 'features.group.export',
      itemKeys: [
        'features.group.export.item1',
        'features.group.export.item2',
        'features.group.export.item3',
        'features.group.export.item4',
      ],
    },
  ];

  readonly shortcuts: [string, string][] = [
    ['P', 'features.shortcut.pen'], ['E', 'features.shortcut.eraser'], ['B', 'features.shortcut.fill'], ['I', 'features.shortcut.picker'],
    ['L', 'features.shortcut.line'], ['R', 'features.shortcut.rectangle'], ['O', 'features.shortcut.ellipse'], ['S', 'features.shortcut.select'],
    ['M', 'features.shortcut.move'], ['Space', 'features.shortcut.pan'], ['Ctrl+Z', 'features.shortcut.undo'], ['Ctrl+Y', 'features.shortcut.redo'],
  ];
}
