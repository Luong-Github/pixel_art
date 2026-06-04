import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { PageSeo, SITE } from './seo.data';

/**
 * Centralises per-route SEO: document title, meta description, canonical link,
 * Open Graph + Twitter cards, robots, and JSON-LD structured data.
 * Driven from route `data` by SiteLayoutComponent so there is a single source of truth.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly ldId = 'page-jsonld';

  constructor(
    private readonly title: Title,
    private readonly meta: Meta,
    @Inject(DOCUMENT) private readonly doc: Document,
  ) {}

  setPage(page: PageSeo): void {
    const fullTitle =
      page.path === '' || !page.title
        ? `${SITE.name} — ${SITE.tagline}`
        : `${page.title} · ${SITE.name}`;
    const description = page.description ?? SITE.description;
    const url = this.absolute(page.path ?? '');
    const image = this.absolute(page.image ?? SITE.ogImage);

    this.title.setTitle(fullTitle);
    this.upsert('description', description);
    this.upsert('robots', page.noIndex ? 'noindex, nofollow' : 'index, follow');

    this.setCanonical(url);

    // Open Graph
    this.upsertProp('og:type', 'website');
    this.upsertProp('og:site_name', SITE.name);
    this.upsertProp('og:title', fullTitle);
    this.upsertProp('og:description', description);
    this.upsertProp('og:url', url);
    this.upsertProp('og:image', image);
    this.upsertProp('og:locale', SITE.locale);

    // Twitter
    this.upsert('twitter:card', 'summary_large_image');
    this.upsert('twitter:title', fullTitle);
    this.upsert('twitter:description', description);
    this.upsert('twitter:image', image);
    this.upsert('twitter:site', SITE.twitter);

    this.setJsonLd(
      page.jsonLd ?? {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: SITE.name,
        url: SITE.url,
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Web browser',
        description: SITE.description,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
    );
  }

  private absolute(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    const clean = path.startsWith('/') ? path : `/${path}`;
    return `${SITE.url}${clean === '/' ? '' : clean}`;
  }

  private upsert(name: string, content: string): void {
    this.meta.updateTag({ name, content });
  }

  private upsertProp(property: string, content: string): void {
    this.meta.updateTag({ property, content });
  }

  private setCanonical(url: string): void {
    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private setJsonLd(data: Record<string, unknown>): void {
    let script = this.doc.getElementById(this.ldId) as HTMLScriptElement | null;
    if (!script) {
      script = this.doc.createElement('script');
      script.id = this.ldId;
      script.type = 'application/ld+json';
      this.doc.head.appendChild(script);
    }
    script.textContent = JSON.stringify(data);
  }
}
