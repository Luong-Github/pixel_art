import { computed, Injectable, signal } from '@angular/core';
import type { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service';

/** Result of an auth action — `{ error }` is the translated-ready message, or null on success. */
export interface AuthResult {
  error: string | null;
}

/**
 * Auth state for the "guest-draw, login-to-save" model. Login is optional and
 * only gates (future) cloud sync — the local IndexedDB flow is untouched.
 *
 * `user`/`session` are signals kept in sync via `onAuthStateChange`; the current
 * session is hydrated once on construction via `getSession`. All methods no-op
 * with a clear error when Supabase isn't configured yet (empty env / SSR) so the
 * UI can show a message instead of failing silently.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly session = signal<Session | null>(null);
  readonly user = signal<User | null>(null);
  readonly signedIn = computed(() => !!this.user());

  constructor(private readonly supabase: SupabaseService) {
    const client = this.supabase.client;
    if (!client) return;

    client.auth.getSession().then(({ data }) => this.apply(data.session));
    client.auth.onAuthStateChange((_event, session) => this.apply(session));
  }

  /** Send a magic-link (one-time code) sign-in email. */
  async signInWithEmail(email: string): Promise<AuthResult> {
    const client = this.supabase.client;
    if (!client) return { error: 'auth.notConfigured' };
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: this.redirectTo() },
    });
    return { error: error?.message ?? null };
  }

  /** Start the Google OAuth redirect flow. On success the page navigates away. */
  async signInWithGoogle(): Promise<AuthResult> {
    const client = this.supabase.client;
    if (!client) return { error: 'auth.notConfigured' };
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: this.redirectTo() },
    });
    return { error: error?.message ?? null };
  }

  async signOut(): Promise<AuthResult> {
    const client = this.supabase.client;
    if (!client) return { error: 'auth.notConfigured' };
    const { error } = await client.auth.signOut();
    return { error: error?.message ?? null };
  }

  private apply(session: Session | null): void {
    this.session.set(session);
    this.user.set(session?.user ?? null);
  }

  private redirectTo(): string | undefined {
    return typeof window !== 'undefined' ? window.location.origin : undefined;
  }
}
