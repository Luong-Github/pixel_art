import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

/**
 * Owns the single Supabase client for the app. Created lazily on first access
 * and only in the browser — the client persists its auth session in
 * localStorage, which doesn't exist during SSR.
 *
 * Uses only the PUBLIC anon key from `environment`; never the service_role key.
 * When the env placeholders are empty `isConfigured` is false and callers
 * should surface a "not set up yet" path instead of making doomed network calls.
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly isBrowser: boolean;
  private cached?: SupabaseClient;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  /** True once both supabaseUrl and supabaseAnonKey are filled in. */
  get isConfigured(): boolean {
    return !!environment.supabaseUrl && !!environment.supabaseAnonKey;
  }

  /**
   * The shared client singleton, or null when running on the server or before
   * the env is configured. Callers must null-check.
   */
  get client(): SupabaseClient | null {
    if (!this.isBrowser || !this.isConfigured) return null;
    if (!this.cached) {
      this.cached = createClient(environment.supabaseUrl, environment.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    return this.cached;
  }
}
