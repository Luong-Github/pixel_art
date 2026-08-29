import { Component, ElementRef, HostListener, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth.service';
import { TranslatePipe } from '../../../i18n/translate.pipe';

/**
 * Topbar auth control. Signed-out: a "Sign in" button opening a small popover
 * (magic-link email + Google). Signed-in: an avatar button opening a menu
 * (email + Sign out). Lives next to the pro-badge in the editor topbar.
 *
 * Every button calls AuthService for real — no no-ops. Buttons disable while a
 * request is in flight, errors surface inline, and after a magic link is sent
 * the popover switches to a "check your email" confirmation.
 */
@Component({
  selector: 'app-sign-in-button',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  template: `
    <div class="auth">
      @if (auth.signedIn()) {
        <button
          type="button"
          class="avatar"
          [title]="auth.user()?.email ?? ''"
          [attr.aria-label]="'auth.account' | t"
          (click)="toggle()"
        >{{ initial() }}</button>
      } @else {
        <button type="button" class="pro-badge sign-in-btn" (click)="toggle()">
          {{ 'auth.signIn' | t }}
        </button>
      }

      @if (open()) {
        <div class="auth-pop" role="dialog" [attr.aria-label]="'auth.account' | t">
          @if (auth.signedIn()) {
            <span class="auth-email">{{ auth.user()?.email }}</span>
            <span class="menu-sep"></span>
            <button type="button" class="auth-action" [disabled]="busy()" (click)="doSignOut()">
              {{ 'auth.signOut' | t }}
            </button>
          } @else if (sent()) {
            <span class="auth-label">{{ 'auth.checkEmail' | t }}</span>
          } @else {
            <span class="auth-label">{{ 'auth.signInTitle' | t }}</span>
            <input
              type="email"
              class="auth-input"
              [placeholder]="'auth.email' | t"
              [(ngModel)]="email"
              [disabled]="busy()"
              (keydown.enter)="sendMagicLink()"
              autocomplete="email"
            />
            <button
              type="button"
              class="auth-action primary"
              [disabled]="busy() || !email.trim()"
              (click)="sendMagicLink()"
            >{{ 'auth.sendMagicLink' | t }}</button>
            <span class="menu-sep"></span>
            <button type="button" class="auth-action" [disabled]="busy()" (click)="continueGoogle()">
              {{ 'auth.continueGoogle' | t }}
            </button>
          }
          @if (error()) {
            <span class="auth-error">{{ error()! | t }}</span>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .auth {
        position: relative;
        display: inline-flex;
      }
      .avatar {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        min-width: 32px;
        padding: 0;
        border-radius: 50%;
        font-weight: 700;
        text-transform: uppercase;
        color: #04201c;
        border-color: transparent;
        background: linear-gradient(135deg, var(--accent-strong), var(--accent));
      }
      .auth-pop {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 200;
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 232px;
        padding: 10px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 10px;
        box-shadow: 0 20px 44px -16px rgba(0, 0, 0, 0.8);
      }
      .auth-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
      }
      .auth-email {
        font-size: 12px;
        color: var(--ink);
        word-break: break-all;
      }
      .auth-input {
        width: 100%;
        min-height: 30px;
        padding: 4px 8px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--field);
        color: var(--ink);
        font-size: 12px;
      }
      .auth-action {
        min-height: 30px;
        padding: 4px 10px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--field);
        color: var(--ink);
        font-size: 12px;
        cursor: pointer;
      }
      .auth-action:hover:not(:disabled) {
        background: var(--hover);
        border-color: var(--accent-line);
      }
      .auth-action:disabled {
        opacity: 0.55;
        cursor: default;
      }
      .auth-action.primary {
        color: #04201c;
        border-color: transparent;
        background: linear-gradient(135deg, var(--accent-strong), var(--accent));
      }
      .menu-sep {
        height: 1px;
        margin: 1px 0;
        background: var(--line);
      }
      .auth-error {
        font-size: 11px;
        color: var(--danger);
        word-break: break-word;
      }
    `,
  ],
})
export class SignInButtonComponent {
  email = '';
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal<string | null>(null);

  constructor(
    public readonly auth: AuthService,
    private readonly host: ElementRef<HTMLElement>,
  ) {}

  initial(): string {
    const u = this.auth.user();
    const src = u?.email || (u?.user_metadata?.['name'] as string | undefined) || '?';
    return src.charAt(0).toUpperCase();
  }

  toggle(): void {
    const next = !this.open();
    if (next) this.reset();
    this.open.set(next);
  }

  async sendMagicLink(): Promise<void> {
    const email = this.email.trim();
    if (!email || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const { error } = await this.auth.signInWithEmail(email);
    this.busy.set(false);
    if (error) this.error.set(error);
    else this.sent.set(true);
  }

  async continueGoogle(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    // On success the browser redirects away; on failure we land back here.
    const { error } = await this.auth.signInWithGoogle();
    if (error) {
      this.busy.set(false);
      this.error.set(error);
    }
  }

  async doSignOut(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const { error } = await this.auth.signOut();
    this.busy.set(false);
    if (error) this.error.set(error);
    else this.open.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.open.set(false);
  }

  private reset(): void {
    this.busy.set(false);
    this.sent.set(false);
    this.error.set(null);
  }
}
