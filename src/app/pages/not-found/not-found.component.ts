import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="section">
      <div class="container center">
        <span class="code">404</span>
        <h1 class="h-lg">This pixel is missing</h1>
        <p class="lead">The page you’re after doesn’t exist or has moved.</p>
        <div class="cta">
          <a routerLink="/" class="btn btn-primary">Back home</a>
          <a routerLink="/editor" class="btn btn-ghost">Open the editor</a>
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
