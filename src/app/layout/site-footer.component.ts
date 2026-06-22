import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../i18n/translate.pipe';

@Component({
  selector: 'app-site-footer',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './site-footer.component.html',
  styleUrl: './site-footer.component.scss',
})
export class SiteFooterComponent {
  readonly year = new Date().getFullYear();

  readonly columns = [
    {
      title: 'footer.colProduct',
      links: [
        { label: 'footer.linkFeatures', path: '/features' },
        { label: 'footer.linkPricing', path: '/pricing' },
        { label: 'footer.linkLaunchApp', path: '/editor' },
      ],
    },
    {
      title: 'footer.colResources',
      links: [
        { label: 'footer.linkGuide', path: '/guide' },
        { label: 'footer.linkBlog', path: '/blog' },
        { label: 'footer.linkFaq', path: '/faq' },
      ],
    },
    {
      title: 'footer.colCompany',
      links: [
        { label: 'footer.linkAbout', path: '/about' },
        { label: 'footer.linkContact', path: '/contact' },
      ],
    },
  ];
}
