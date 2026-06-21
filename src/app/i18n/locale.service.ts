import { Injectable, signal } from '@angular/core';
import { Lang, LANGS, TRANSLATIONS } from './translations';

/**
 * Runtime localization. `lang` is a signal so the UI switches instantly with no
 * rebuild. Missing keys fall back to English, then to the raw key.
 */
@Injectable({ providedIn: 'root' })
export class LocaleService {
  private readonly key = 'pixelart.lang';
  readonly langs = LANGS;
  readonly lang = signal<Lang>('en');

  constructor() {
    this.lang.set(this.detect());
  }

  private detect(): Lang {
    try {
      const saved = localStorage.getItem(this.key) as Lang | null;
      if (saved && saved in TRANSLATIONS) return saved;
    } catch {
      /* storage unavailable */
    }
    const nav =
      typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
    return (nav in TRANSLATIONS ? nav : 'en') as Lang;
  }

  setLang(lang: Lang): void {
    this.lang.set(lang);
    try {
      localStorage.setItem(this.key, lang);
    } catch {
      /* storage unavailable */
    }
  }

  /** Translate `key`, interpolating `{name}`-style params. */
  t(key: string, params?: Record<string, string | number>): string {
    const lang = this.lang();
    let str =
      TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  }
}
