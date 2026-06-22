import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LocaleService } from '../i18n/locale.service';
import { Lang } from '../i18n/translations';
import { TranslatePipe } from '../i18n/translate.pipe';

@Component({
  selector: 'app-site-header',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, TranslatePipe],
  templateUrl: './site-header.component.html',
  styleUrl: './site-header.component.scss',
})
export class SiteHeaderComponent {
  open = false;
  langOpen = false;

  constructor(public locale: LocaleService) {}

  get currentLangLabel(): string {
    return this.locale.langs.find((l) => l.code === this.locale.lang())?.label ?? '';
  }

  toggleLang(event: Event): void {
    event.stopPropagation();
    this.langOpen = !this.langOpen;
  }

  setLang(lang: Lang): void {
    this.locale.setLang(lang);
    this.langOpen = false;
  }

  /** Close the language menu on any outside click (the trigger stops propagation). */
  @HostListener('document:click')
  closeLang(): void {
    this.langOpen = false;
  }

  readonly nav = [
    { key: 'nav.features', path: '/features' },
    { key: 'nav.guide', path: '/guide' },
    { key: 'nav.pricing', path: '/pricing' },
    { key: 'nav.blog', path: '/blog' },
    { key: 'nav.about', path: '/about' },
  ];

  toggle(): void {
    this.open = !this.open;
  }

  close(): void {
    this.open = false;
  }
}
