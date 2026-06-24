import { Component } from '@angular/core';
import { NotificationService } from './notification.service';
import { TranslatePipe } from '../../i18n/translate.pipe';

/**
 * Renders the NotificationService toasts in a fixed bottom-right stack.
 * Mounted once in AppComponent so it overlays both the site and the editor
 * (the editor host uses overflow:hidden, so a toast can't live inside it).
 */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="toast-host" aria-live="polite">
      @for (t of notify.toasts(); track t.id) {
        <div
          class="toast toast--{{ t.kind }}"
          [attr.role]="t.kind === 'error' ? 'alert' : 'status'"
          (mouseenter)="notify.pause(t.id)"
          (mouseleave)="notify.resume(t.id)"
        >
          <span class="toast__icon" aria-hidden="true">
            @switch (t.kind) {
              @case ('success') { ✓ }
              @case ('error') { ✕ }
              @case ('loading') { <span class="spinner"></span> }
              @default { ⓘ }
            }
          </span>
          <span class="toast__msg">{{ t.message }}</span>
          @if (t.kind !== 'loading') {
            <button
              type="button"
              class="toast__x"
              [attr.aria-label]="'notify.dismiss' | t"
              (click)="notify.dismiss(t.id)"
            >✕</button>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-host {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: flex-end;
        max-width: min(380px, calc(100vw - 40px));
        pointer-events: none;
      }
      .toast {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 240px;
        max-width: 380px;
        padding: 10px 12px;
        background: var(--surface);
        color: var(--text);
        border: 1px solid var(--border);
        border-left: 3px solid var(--border-strong);
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow);
        font-family: var(--font);
        font-size: 13px;
        line-height: 1.4;
        animation: toast-in 0.2s ease-out;
      }
      .toast--success { border-left-color: var(--brand-bright); }
      .toast--error { border-left-color: #e5484d; }
      .toast--info { border-left-color: #4a9eff; }
      .toast--loading { border-left-color: var(--brand); }
      .toast__icon { flex: none; width: 18px; text-align: center; font-weight: 700; }
      .toast--success .toast__icon { color: var(--brand-bright); }
      .toast--error .toast__icon { color: #e5484d; }
      .toast--info .toast__icon { color: #4a9eff; }
      .toast__msg { flex: 1; min-width: 0; }
      .toast__x {
        flex: none;
        border: none;
        background: none;
        cursor: pointer;
        color: var(--text-dim);
        font-size: 13px;
        padding: 4px 6px;
        border-radius: 6px;
        line-height: 1;
      }
      .toast__x:hover { color: var(--text); background: rgba(255, 255, 255, 0.06); }
      .spinner {
        display: inline-block;
        width: 13px;
        height: 13px;
        border: 2px solid var(--border-strong);
        border-top-color: var(--brand);
        border-radius: 50%;
        animation: toast-spin 0.7s linear infinite;
      }
      @keyframes toast-in {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes toast-spin { to { transform: rotate(360deg); } }
    `,
  ],
})
export class ToastHostComponent {
  constructor(readonly notify: NotificationService) {}
}
