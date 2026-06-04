import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="section-tight page-hero">
      <div class="container narrow">
        <span class="eyebrow">About</span>
        <h1 class="h-xl">Pixel art, without the friction</h1>
      </div>
    </section>

    <section class="section-tight">
      <div class="container narrow prose">
        <p class="lead">
          Pixel Art Studio started as a simple idea: a serious pixel editor that opens instantly in
          a browser tab, with no downloads, accounts or setup. Just open it and draw.
        </p>
        <p>
          Most pixel tools force a choice between “powerful but heavy desktop app” and “toy web
          drawing pad.” We wanted the middle: a focused, production-style workspace — a tool rail,
          a real canvas with zoom and pan, a frame and layer timeline, and an inspector for image
          conversion and exports — all running locally in your browser.
        </p>
        <p>
          Everything happens on your machine. Your sprites never leave the page, the editor works
          offline, and you can export a PNG or a portable project file whenever you like.
        </p>
        <h2 class="h-lg">What we believe</h2>
        <ul>
          <li><strong>Instant.</strong> The best tool is the one already open.</li>
          <li><strong>Focused.</strong> Pixel art deserves purpose-built controls, not generic brushes.</li>
          <li><strong>Yours.</strong> Local-first, exportable, no lock-in.</li>
        </ul>
        <div class="cta">
          <a routerLink="/editor" class="btn btn-primary btn-lg">Open the studio →</a>
          <a routerLink="/contact" class="btn btn-ghost btn-lg">Get in touch</a>
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
