import { computed, effect, Injectable, signal } from '@angular/core';
import { ApiClientService } from '../core/api/api-client.service';
import { AuthService } from '../core/auth/auth.service';

/** Mirror of `GET /me/entitlements`. */
interface Entitlements {
  cloudTier: 'free' | 'pro';
  proExport: boolean;
  cloudUntil: string | null;
}

interface CachedEntitlements extends Entitlements {
  fetchedAt: number;
}

const CACHE_KEY = 'pixelart.entitlements';
/** How long a cached answer keeps Pro working with no network. */
const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Pro state, server-authoritative. The old localStorage flag + hardcoded demo key
 * are gone: `/me/entitlements` is the source of truth, and the only thing kept
 * locally is a **cached copy with an expiry** so a paying artist who opens their
 * laptop on a train still gets what they paid for (offline grace, D-8).
 *
 * Honest note, matching D-8: this cache can be forged, but forging it only opens
 * the soft-gated features that already run on the user's own CPU. The
 * capabilities that matter — unlimited cloud, AI — are enforced server-side and
 * no client flag reaches them.
 */
@Injectable({ providedIn: 'root' })
export class PremiumService {
  private readonly cloudTier = signal<'free' | 'pro'>('free');
  private readonly proExport = signal(false);
  private readonly isProSignal = computed(() => this.proExport());

  constructor(
    private readonly api: ApiClientService,
    private readonly auth: AuthService,
  ) {
    this.restoreFromCache();
    effect(
      () => {
        // Signed in (now, or state changed): ask the server. Signed out: Pro is gone
        // immediately — grace is for lost networks, not for logged-out sessions.
        if (this.auth.signedIn()) void this.refresh();
        else this.apply({ cloudTier: 'free', proExport: false, cloudUntil: null }, false);
      },
      // The signed-out branch writes our signals synchronously; that is the whole
      // point of this effect (mirror auth state into entitlements), so writes are
      // intentional — without this flag Angular throws NG0600 and KILLS the effect,
      // leaving a stale Pro badge after sign-out.
      { allowSignalWrites: true },
    );
  }

  /**
   * Kept as a property-style getter so the ~20 existing `premium.isPro` call
   * sites (gates, watermark, template) did not need to change.
   */
  get isPro(): boolean {
    return this.isProSignal();
  }

  /** Ask the server. On network failure, fall back to the cache within grace. */
  async refresh(): Promise<void> {
    try {
      const fresh = await this.api.get<Entitlements>('/me/entitlements');
      this.apply(fresh, true);
    } catch {
      this.restoreFromCache();
    }
  }

  /** Start a Stripe Checkout and leave the page. Rejects with a translatable key. */
  async startCheckout(plan: 'subscription' | 'license'): Promise<void> {
    const url = await this.api.post<string>('/billing/checkout', { plan });
    window.location.href = url;
  }

  private apply(value: Entitlements, cache: boolean): void {
    this.cloudTier.set(value.cloudTier);
    this.proExport.set(value.proExport);
    if (cache) this.writeCache(value);
  }

  private restoreFromCache(): void {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw) as CachedEntitlements;
      if (Date.now() - cached.fetchedAt > OFFLINE_GRACE_MS) {
        localStorage.removeItem(CACHE_KEY);
        return;
      }
      this.cloudTier.set(cached.cloudTier);
      this.proExport.set(cached.proExport);
    } catch {
      /* private mode / SSR / corrupt cache — free is the safe default */
    }
  }

  private writeCache(value: Entitlements): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...value, fetchedAt: Date.now() }));
    } catch {
      /* ignore */
    }
  }
}
