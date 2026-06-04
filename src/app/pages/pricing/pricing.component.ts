import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Plan {
  name: string;
  price: string;
  period: string;
  blurb: string;
  features: string[];
  cta: string;
  ctaLink: string;
  featured?: boolean;
}

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './pricing.component.html',
  styleUrl: './pricing.component.scss',
})
export class PricingComponent {
  readonly plans: Plan[] = [
    {
      name: 'Free',
      price: '$0',
      period: 'forever',
      blurb: 'The full editor, in your browser, with nothing to pay.',
      features: [
        'All drawing tools',
        'Frame & layer animation',
        'Image-to-pixel conversion',
        'PNG & project export',
        'Runs fully offline',
      ],
      cta: 'Launch the app',
      ctaLink: '/editor',
      featured: true,
    },
    {
      name: 'Pro',
      price: '$5',
      period: 'per month',
      blurb: 'For frequent creators who want cloud sync and more.',
      features: [
        'Everything in Free',
        'Cloud project sync',
        'Larger canvases & palettes',
        'Animated GIF / sprite-sheet export',
        'Priority support',
      ],
      cta: 'Coming soon',
      ctaLink: '/contact',
    },
    {
      name: 'Team',
      price: 'Custom',
      period: 'contact us',
      blurb: 'Shared libraries and collaboration for studios.',
      features: [
        'Everything in Pro',
        'Shared palettes & assets',
        'Team workspaces',
        'SSO & admin controls',
      ],
      cta: 'Talk to us',
      ctaLink: '/contact',
    },
  ];
}
