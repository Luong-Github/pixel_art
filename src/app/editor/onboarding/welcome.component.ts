import { Component, EventEmitter, Output } from '@angular/core';
import { TranslatePipe } from '../../i18n/translate.pipe';

/**
 * First-run welcome card — a small 4-step intro shown once (gated by a
 * localStorage flag in the editor). Re-openable from View ▾. Deliberately a
 * simple step carousel rather than DOM-anchored spotlights (robust to layout).
 */
@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="welcome-overlay" (click)="skip()">
      <div
        class="welcome-card"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="'welcome.title' | t"
        (click)="$event.stopPropagation()"
      >
        <span class="welcome-eyebrow">{{ 'welcome.eyebrow' | t }}</span>
        <h2 class="welcome-title">{{ 'welcome.title' | t }}</h2>
        <p class="welcome-step">{{ steps[i] | t }}</p>
        <div class="welcome-dots" aria-hidden="true">
          @for (s of steps; track $index) {
            <span class="dot" [class.on]="$index === i"></span>
          }
        </div>
        <div class="welcome-actions">
          <button type="button" class="welcome-skip" (click)="skip()">{{ 'welcome.skip' | t }}</button>
          @if (i < steps.length - 1) {
            <button type="button" class="welcome-next" (click)="i = i + 1">{{ 'welcome.next' | t }}</button>
          } @else {
            <button type="button" class="welcome-next" (click)="skip()">{{ 'welcome.start' | t }}</button>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .welcome-overlay {
        position: fixed;
        inset: 0;
        z-index: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(5, 8, 12, 0.6);
        backdrop-filter: blur(2px);
      }
      .welcome-card {
        width: min(420px, calc(100vw - 32px));
        background: var(--surface, #141b24);
        border: 1px solid var(--border, #212b38);
        border-radius: var(--radius, 16px);
        box-shadow: var(--shadow, 0 24px 60px -28px rgba(0, 0, 0, 0.8));
        padding: 22px 22px 18px;
        font-family: var(--font);
        color: var(--text, #eef3f8);
      }
      .welcome-eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--brand-bright, #34e0c6);
      }
      .welcome-title { font-size: 20px; margin: 6px 0 12px; }
      .welcome-step {
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-muted, #9aabbb);
        min-height: 66px;
      }
      .welcome-dots { display: flex; gap: 6px; margin: 6px 0 16px; }
      .welcome-dots .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--border-strong, #2d3a49);
      }
      .welcome-dots .dot.on { background: var(--brand-bright, #34e0c6); }
      .welcome-actions { display: flex; justify-content: space-between; align-items: center; }
      .welcome-skip {
        border: none;
        background: none;
        color: var(--text-dim, #647688);
        cursor: pointer;
        font-size: 13px;
        padding: 6px 8px;
      }
      .welcome-skip:hover { color: var(--text); }
      .welcome-next {
        border: none;
        border-radius: 9px;
        background: var(--brand, #1f9e8d);
        color: #04110e;
        font-weight: 700;
        cursor: pointer;
        font-size: 13px;
        padding: 8px 16px;
      }
      .welcome-next:hover { background: var(--brand-bright, #34e0c6); }
    `,
  ],
})
export class WelcomeComponent {
  @Output() done = new EventEmitter<void>();
  i = 0;
  readonly steps = ['welcome.s1', 'welcome.s2', 'welcome.s3', 'welcome.s4'];

  skip(): void {
    this.done.emit();
  }
}
