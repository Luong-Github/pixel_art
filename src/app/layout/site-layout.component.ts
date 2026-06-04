import { Component, OnDestroy, OnInit } from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { PageSeo } from '../core/seo/seo.data';
import { SeoService } from '../core/seo/seo.service';
import { SiteFooterComponent } from './site-footer.component';
import { SiteHeaderComponent } from './site-header.component';

/**
 * Marketing chrome (header + footer) shared by all public pages.
 * Reads `seo` from the deepest activated route's `data` after each navigation
 * and applies it through SeoService — a single source of truth for page meta.
 */
@Component({
  selector: 'app-site-layout',
  standalone: true,
  imports: [RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  template: `
    <app-site-header />
    <main id="main" class="site-main">
      <router-outlet />
    </main>
    <app-site-footer />
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
      .site-main {
        flex: 1;
      }
    `,
  ],
})
export class SiteLayoutComponent implements OnInit, OnDestroy {
  private sub?: Subscription;

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.apply();
    this.sub = this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => this.apply());
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private apply(): void {
    let r = this.route;
    while (r.firstChild) r = r.firstChild;
    // Pages with dynamic content (e.g. blog post) set their own SEO.
    if (r.snapshot.data['skipSeo']) return;
    const seo = (r.snapshot.data['seo'] as PageSeo | undefined) ?? {
      title: '',
      path: r.snapshot.url.map((s) => s.path).join('/'),
    };
    this.seo.setPage(seo);
  }
}
