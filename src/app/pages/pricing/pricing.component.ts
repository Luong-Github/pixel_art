import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../i18n/translate.pipe';

interface Plan {
  nameKey: string;
  price: string;
  periodKey: string;
  blurbKey: string;
  featureKeys: string[];
  ctaKey: string;
  ctaLink: string;
  featured?: boolean;
}

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './pricing.component.html',
  styleUrl: './pricing.component.scss',
})
export class PricingComponent {
  readonly plans: Plan[] = [
    {
      nameKey: 'pricing.planFreeName',
      price: '$0',
      periodKey: 'pricing.planFreePeriod',
      blurbKey: 'pricing.planFreeBlurb',
      featureKeys: [
        'pricing.featureAllTools',
        'pricing.featureFrameLayer',
        'pricing.featureImageToPixel',
        'pricing.featurePngExport',
        'pricing.featureOffline',
      ],
      ctaKey: 'pricing.ctaLaunch',
      ctaLink: '/editor',
      featured: true,
    },
    {
      nameKey: 'pricing.planProName',
      price: '$5',
      periodKey: 'pricing.planProPeriod',
      blurbKey: 'pricing.planProBlurb',
      featureKeys: [
        'pricing.featureEverythingFree',
        'pricing.featureCloudSync',
        'pricing.featureLargerCanvas',
        'pricing.featureGifExport',
        'pricing.featurePrioritySupport',
      ],
      ctaKey: 'pricing.ctaComingSoon',
      ctaLink: '/contact',
    },
    {
      nameKey: 'pricing.planTeamName',
      price: 'Custom',
      periodKey: 'pricing.planTeamPeriod',
      blurbKey: 'pricing.planTeamBlurb',
      featureKeys: [
        'pricing.featureEverythingPro',
        'pricing.featureSharedAssets',
        'pricing.featureTeamWorkspaces',
        'pricing.featureSso',
      ],
      ctaKey: 'pricing.ctaTalkToUs',
      ctaLink: '/contact',
    },
  ];
}
