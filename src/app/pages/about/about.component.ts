import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../i18n/translate.pipe';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="section-tight page-hero">
      <div class="container narrow">
        <span class="eyebrow">{{ 'about.eyebrow' | t }}</span>
        <h1 class="h-xl">{{ 'about.heroTitle' | t }}</h1>
      </div>
    </section>

    <section class="section-tight">
      <div class="container narrow prose">
        <p class="lead">
          {{ 'about.lead' | t }}
        </p>
        <p>
          {{ 'about.para2' | t }}
        </p>
        <p>
          {{ 'about.para3' | t }}
        </p>
        <h2 class="h-lg">{{ 'about.believeTitle' | t }}</h2>
        <ul>
          <li><strong>{{ 'about.believeInstantLabel' | t }}</strong> {{ 'about.believeInstantText' | t }}</li>
          <li><strong>{{ 'about.believeFocusedLabel' | t }}</strong> {{ 'about.believeFocusedText' | t }}</li>
          <li><strong>{{ 'about.believeYoursLabel' | t }}</strong> {{ 'about.believeYoursText' | t }}</li>
        </ul>
        <div class="cta">
          <a routerLink="/editor" class="btn btn-primary btn-lg">{{ 'about.openStudio' | t }}</a>
          <a routerLink="/contact" class="btn btn-ghost btn-lg">{{ 'about.getInTouch' | t }}</a>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .page-hero { padding-top: 56px; }
      .narrow { max-width: 720px; }
      .prose p { color: var(--text-muted); line-height: 1.75; font-size: 16px; margin: 0 0 18px; }
      .prose .lead { color: var(--text); }
      .prose h2 { margin: 36px 0 14px; }
      .prose ul { color: var(--text-muted); line-height: 1.8; padding-left: 20px; }
      .prose li strong { color: var(--text); }
      .cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
    `,
  ],
})
export class AboutComponent {}
