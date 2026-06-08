import { Injectable } from '@angular/core';

const STORAGE_KEY = 'pixelart.pro';
/** Demo license key — replace with real validation once billing is wired up. */
const DEMO_KEY = 'PIXELPRO';

/**
 * Tracks whether the user has unlocked Pro features. There is no billing backend
 * yet, so Pro state is held in localStorage and "activated" with a demo key.
 * Swap `activate()` for a real license/Stripe check later.
 */
@Injectable({ providedIn: 'root' })
export class PremiumService {
  isPro = false;

  constructor() {
    try {
      if (typeof localStorage !== 'undefined') {
        this.isPro = localStorage.getItem(STORAGE_KEY) === '1';
      }
    } catch {
      /* private mode / SSR */
    }
  }

  /** Returns true if the key unlocked Pro. */
  activate(key: string): boolean {
    if (key.trim().toUpperCase().startsWith(DEMO_KEY)) {
      this.setPro(true);
      return true;
    }
    return false;
  }

  setPro(value: boolean): void {
    this.isPro = value;
    try {
      if (typeof localStorage !== 'undefined') {
        if (value) localStorage.setItem(STORAGE_KEY, '1');
        else localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }
}
