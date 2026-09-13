import { computed, Injectable, signal } from '@angular/core';
import { ApiClientService, ApiError } from '../api/api-client.service';

/** Result of an auth action — `{ error }` is the translated-ready message, or null on success. */
export interface AuthResult {
  error: string | null;
}

/** The signed-in user, as far as the client is allowed to know. */
export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

/**
 * Auth state for the "guest-draw, login-to-save" model. Login is optional and
 * only gates cloud sync — the local IndexedDB flow is untouched.
 *
 * The browser holds NO tokens. Sign-in happens entirely server-side: the API
 * talks to the auth provider, then sets HttpOnly cookies the page can't read.
 * So this service has no session to hydrate from storage — it simply asks
 * `/me` who the caller is.
 *
 * The public shape (`user`, `signedIn`, `signInWithEmail`, `signInWithGoogle`,
 * `signOut`) is unchanged from the previous supabase-js implementation on
 * purpose: `sign-in-button.component.ts` didn't need a single edit.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AuthUser | null>(null);
  readonly signedIn = computed(() => !!this.user());

  constructor(private readonly api: ApiClientService) {
    if (this.api.isConfigured) void this.refresh();
  }

  /** Ask the server who we are. Also warms the CSRF cookie for later mutations. */
  async refresh(): Promise<void> {
    try {
      this.user.set(await this.api.get<AuthUser>('/me'));
    } catch {
      // 401 is the normal "not signed in" answer, not an error worth surfacing.
      this.user.set(null);
    }
  }

  /** Send a magic-link sign-in email. The link completes the flow on the server. */
  async signInWithEmail(email: string): Promise<AuthResult> {
    return this.attempt(() => this.api.post<void>('/auth/magic-link', { email }));
  }

  /**
   * Start the Google OAuth redirect flow. On success the page navigates away, so
   * nothing after this resolves matters.
   */
  async signInWithGoogle(): Promise<AuthResult> {
    if (!this.api.isConfigured) return { error: 'auth.notConfigured' };
    // Must be a real navigation, not fetch: the OAuth provider needs to show its
    // own consent screen and then redirect back to the API's callback.
    window.location.href = this.api.urlFor('/auth/google');
    return { error: null };
  }

  async signOut(): Promise<AuthResult> {
    const result = await this.attempt(() => this.api.post<void>('/auth/signout'));
    this.user.set(null);
    return result;
  }

  private async attempt(action: () => Promise<unknown>): Promise<AuthResult> {
    if (!this.api.isConfigured) return { error: 'auth.notConfigured' };
    try {
      await action();
      return { error: null };
    } catch (error) {
      return { error: error instanceof ApiError ? error.message : 'auth.failed' };
    }
  }
}
