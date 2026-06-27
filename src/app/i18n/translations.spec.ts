import { TRANSLATIONS, LANGS, Lang } from './translations';

/**
 * i18n key-parity (FEAT-48 / AC-26-1). The runtime translate pipe falls back to
 * the raw key when a lang is missing it — so a missing key silently ships an
 * untranslated string. This spec is the regression net: every key in the `en`
 * dictionary must exist in vi/zh/fr/ru, and no non-en dict may carry an orphan
 * key that `en` lacks. Pure data assertions — no TestBed, runs in ms.
 */
describe('i18n translations — key parity across 5 langs', () => {
  const enKeys = Object.keys(TRANSLATIONS.en);
  const otherLangs: Lang[] = ['vi', 'zh', 'fr', 'ru'];

  it('declares exactly the 5 supported languages', () => {
    expect(Object.keys(TRANSLATIONS).sort()).toEqual(['en', 'fr', 'ru', 'vi', 'zh']);
    expect(LANGS.map((l) => l.code).sort()).toEqual(['en', 'fr', 'ru', 'vi', 'zh']);
  });

  it('has a non-empty en dictionary', () => {
    expect(enKeys.length).toBeGreaterThan(0);
  });

  for (const lang of otherLangs) {
    describe(`'${lang}'`, () => {
      const langKeys = new Set(Object.keys(TRANSLATIONS[lang]));

      it(`contains every 'en' key`, () => {
        const missing = enKeys.filter((k) => !langKeys.has(k));
        expect(missing).withContext(
          `'${lang}' is missing ${missing.length} key(s) present in 'en': ${missing.join(', ')}`,
        ).toEqual([]);
      });

      it(`has no orphan key absent from 'en'`, () => {
        const enSet = new Set(enKeys);
        const orphans = [...langKeys].filter((k) => !enSet.has(k));
        expect(orphans).withContext(
          `'${lang}' has ${orphans.length} key(s) not in 'en': ${orphans.join(', ')}`,
        ).toEqual([]);
      });

      it(`has no blank value`, () => {
        const blanks = [...langKeys].filter((k) => TRANSLATIONS[lang][k].trim() === '');
        expect(blanks).withContext(
          `'${lang}' has blank value(s): ${blanks.join(', ')}`,
        ).toEqual([]);
      });
    });
  }
});
