import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../i18n/translate.pipe';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="section">
      <div class="container center">
        <span class="code">404</span>
        <h1 class="h-lg">{{ 'notfound.title' | t }}</h1>
        <p class="lead">{{ 'notfound.lead' | t }}</p>
        <div class="cta">
          <a routerLink="/" class="btn btn-primary">{{ 'notfound.backHome' | t }}</a>
          <a routerLink="/editor" class="btn btn-ghost">{{ 'notfound.openEditor' | t }}</a>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .center { text-align: center; max-width: 560px; padding-block: 40px; }
      .code { display: inline-block; font-size: 84px; font-weight: 800; letter-spacing: -0.04em; color: var(--brand); opacity: 0.5; }
      h1 { margin: 6px 0 12px; }
      .cta { display: flex; gap: 12px; justify-content: center; margin-top: 26px; flex-wrap: wrap; }
    `,
  ],
})
export class NotFoundComponent {}
