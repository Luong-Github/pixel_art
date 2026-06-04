import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Qa {
  q: string;
  a: string;
}

@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="section-tight page-hero">
      <div class="container narrow center">
        <span class="eyebrow">FAQ</span>
        <h1 class="h-xl">Frequently asked questions</h1>
        <p class="lead">Everything about using Pixel Art Studio.</p>
      </div>
    </section>

    <section class="section-tight">
      <div class="container narrow">
        <div class="acc">
          <details class="item" *ngFor="let item of faqs; let i = index" [open]="i === 0">
            <summary>
              <span>{{ item.q }}</span>
              <span class="chev" aria-hidden="true">+</span>
            </summary>
            <p>{{ item.a }}</p>
          </details>
        </div>

        <div class="more">
          <p>Still stuck?</p>
          <a routerLink="/contact" class="btn btn-ghost">Contact support</a>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .page-hero { padding-top: 56px; }
      .narrow { max-width: 760px; }
      .center { text-align: center; }
      .center h1 { margin: 6px 0 12px; }
      .acc { display: flex; flex-direction: column; gap: 12px; }
      .item {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 4px 20px;
      }
      summary {
        list-style: none;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 16px 0;
        font-weight: 600;
        color: var(--text);
      }
      summary::-webkit-details-marker { display: none; }
      .chev { color: var(--brand); font-size: 22px; line-height: 1; transition: transform 0.2s; }
      .item[open] .chev { transform: rotate(45deg); }
      .item p { color: var(--text-muted); line-height: 1.7; margin: 0 0 18px; }
      .more { text-align: center; margin-top: 36px; color: var(--text-muted); }
      .more p { margin-bottom: 12px; }
    `,
  ],
})
export class FaqComponent {
  readonly faqs: Qa[] = [
    {
      q: 'Is Pixel Art Studio free?',
      a: 'Yes. The full editor — drawing tools, animation, layers, image conversion and export — is free to use in your browser with no account required.',
    },
    {
      q: 'Do I need to install anything?',
      a: 'No. It runs entirely in the browser. Just open the app and start drawing. It also works offline once loaded.',
    },
    {
      q: 'Where are my drawings stored?',
      a: 'Everything stays on your device. Nothing is uploaded. Use “Export Project” to save a .pixelart.json file you can reload later, or export a PNG.',
    },
    {
      q: 'Can I animate sprites?',
      a: 'Yes. There is a frame timeline with per-frame duration, onion skin and live playback, plus a layer timeline for organising your art.',
    },
    {
      q: 'Can I turn a photo into pixel art?',
      a: 'Yes. The Image Convert panel imports any image and reduces it to a palette, with controls for size, fit, dithering, contrast and sharpening.',
    },
    {
      q: 'What can I export?',
      a: 'PNG at 1x, PNG scaled to your current zoom, and a full .pixelart.json project containing your workspaces, frames, layers, palette and settings.',
    },
    {
      q: 'Which browsers are supported?',
      a: 'Any modern browser (Chrome, Edge, Firefox, Safari). The on-screen color picker uses the EyeDropper API where available.',
    },
  ];
}
