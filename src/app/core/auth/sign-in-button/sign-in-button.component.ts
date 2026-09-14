import { Component, ElementRef, HostListener, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth.service';
import { AiApiService } from '../../../editor/projects/ai-api.service';
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
        <div class="auth-pop" role="dialog" [attr.aria-label]="'auth.account' | t"
          [style.left.px]="popLeft()" [style.top.px]="popTop()">
          @if (auth.signedIn()) {
            <span class="auth-email">{{ auth.user()?.email }}</span>
            <span class="menu-sep"></span>
            <label class="auth-optin" [title]="'auth.trainingOptInHint' | t">
              <input type="checkbox" [checked]="trainingOptIn()" [disabled]="optInBusy()"
                (change)="toggleTrainingOptIn($event)" />
              {{ 'auth.trainingOptIn' | t }}
            </label>
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
        /* Stacking context cao hon moi dock panel: khong co dong nay, panel Tools
           (DOM dung sau topbar) de len nua trai cua popup du popup co z-index rieng. */
        z-index: 250;
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
        /* fixed, KHONG absolute: .workspace co overflow hidden va cat cut moi thu
           tho ra ngoai mep trai cua no — z-index cao den may cung khong cuu duoc
           mot phan tu khong duoc VE. fixed thoat khoi cay clip (khong ancestor nao
           co transform), vi tri neo theo nut duoc tinh luc mo. */
        position: fixed;
        z-index: 250;
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
      .auth-optin {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 12px;
        line-height: 1.35;
        color: var(--muted);
        cursor: pointer;
      }
      .auth-optin input {
        margin-top: 2px;
        accent-color: var(--accent);
        cursor: pointer;
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
    private readonly aiApi: AiApiService,
    private readonly host: ElementRef<HTMLElement>,
  ) {}

  initial(): string {
    const u = this.auth.user();
    const src = u?.email || (u?.user_metadata?.['name'] as string | undefined) || '?';
    return src.charAt(0).toUpperCase();
  }

  readonly popLeft = signal(0);
  readonly popTop = signal(0);

  private static readonly POP_WIDTH = 232;

  /** Neo popup theo mép phải của nút, kẹp trong viewport (popup là position: fixed). */
  private placePopup(): void {
    const btn = this.host.nativeElement.querySelector('.avatar, .sign-in-btn') as HTMLElement | null;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, r.right - SignInButtonComponent.POP_WIDTH),
      window.innerWidth - SignInButtonComponent.POP_WIDTH - 8,
    );
    this.popLeft.set(Math.round(left));
    this.popTop.set(Math.round(r.bottom + 6));
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.open()) this.placePopup();
  }

  readonly trainingOptIn = signal(false);
  readonly optInBusy = signal(false);
  private optInLoaded = false;

  /**
   * Consent for using the user's art to train models (TE0.2). OFF by default and
   * never flipped silently — pixel artists have every reason to distrust silent
   * opt-ins, and one betrayed default costs more than the training data is worth.
   */
  async toggleTrainingOptIn(event: Event): Promise<void> {
    const enabled = (event.target as HTMLInputElement).checked;
    this.optInBusy.set(true);
    try {
      await this.aiApi.setTrainingOptIn(enabled);
      this.trainingOptIn.set(enabled);
    } catch {
      (event.target as HTMLInputElement).checked = this.trainingOptIn();
    } finally {
      this.optInBusy.set(false);
    }
  }

  private async loadTrainingOptIn(): Promise<void> {
    if (this.optInLoaded || !this.auth.signedIn()) return;
    this.optInLoaded = true;
    try {
      this.trainingOptIn.set((await this.aiApi.getTrainingOptIn()).enabled);
    } catch {
      /* hiển thị mặc định false — an toàn */
    }
  }

  toggle(): void {
    void this.loadTrainingOptIn();
    this.placePopup();
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
