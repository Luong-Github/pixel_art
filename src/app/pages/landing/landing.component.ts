import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../i18n/translate.pipe';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
})
export class LandingComponent {
  readonly highlights = [
    {
      icon: '✏️',
      titleKey: 'landing.featDrawingTitle',
      textKey: 'landing.featDrawingText',
    },
    {
      icon: '🎞️',
      titleKey: 'landing.featAnimTitle',
      textKey: 'landing.featAnimText',
    },
    {
      icon: '🧅',
      titleKey: 'landing.featLayersTitle',
      textKey: 'landing.featLayersText',
    },
    {
      icon: '🖼️',
      titleKey: 'landing.featImageTitle',
      textKey: 'landing.featImageText',
    },
    {
      icon: '🎨',
      titleKey: 'landing.featColorTitle',
      textKey: 'landing.featColorText',
    },
    {
      icon: '📦',
      titleKey: 'landing.featExportTitle',
      textKey: 'landing.featExportText',
    },
  ];

  readonly steps = [
    { n: '01', titleKey: 'landing.step1Title', textKey: 'landing.step1Text' },
    { n: '02', titleKey: 'landing.step2Title', textKey: 'landing.step2Text' },
    { n: '03', titleKey: 'landing.step3Title', textKey: 'landing.step3Text' },
  ];
}
