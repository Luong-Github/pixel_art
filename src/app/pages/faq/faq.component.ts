import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../i18n/translate.pipe';

interface Qa {
  q: string;
  a: string;
}

@Component({
  selector: 'app-faq',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  template: `
    <section class="section-tight page-hero">
      <div class="container narrow center">
        <span class="eyebrow">{{ 'faq.eyebrow' | t }}</span>
        <h1 class="h-xl">{{ 'faq.title' | t }}</h1>
        <p class="lead">{{ 'faq.lead' | t }}</p>
      </div>
    </section>

    <section class="section-tight">
      <div class="container narrow">
        <div class="acc">
          <details class="item" *ngFor="let item of faqs; let i = index" [open]="i === 0">
            <summary>
              <span>{{ item.q | t }}</span>
              <span class="chev" aria-hidden="true">+</span>
            </summary>
            <p>{{ item.a | t }}</p>
          </details>
        </div>

        <div class="more">
          <p>{{ 'faq.stillStuck' | t }}</p>
          <a routerLink="/contact" class="btn btn-ghost">{{ 'faq.contactSupport' | t }}</a>
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
      q: 'faq.q1',
      a: 'faq.a1',
    },
    {
      q: 'faq.q2',
      a: 'faq.a2',
    },
    {
      q: 'faq.q3',
      a: 'faq.a3',
    },
    {
      q: 'faq.q4',
      a: 'faq.a4',
    },
    {
      q: 'faq.q5',
      a: 'faq.a5',
    },
    {
      q: 'faq.q6',
      a: 'faq.a6',
    },
    {
      q: 'faq.q7',
      a: 'faq.a7',
    },
  ];
}
