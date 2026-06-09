import { Routes } from '@angular/router';
import { PageSeo } from './core/seo/seo.data';
import { SiteLayoutComponent } from './layout/site-layout.component';

const seo = (data: PageSeo) => ({ seo: data });

export const routes: Routes = [
  {
    // Full-screen editor — no marketing chrome, lazy-loaded, client-only.
    // Declared before the site layout so its wildcard child can't swallow it.
    path: 'editor',
    loadComponent: () => import('./editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    path: '',
    component: SiteLayoutComponent,
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/landing/landing.component').then((m) => m.LandingComponent),
        data: seo({ title: '', path: '' }),
      },
      {
        path: 'features',
        loadComponent: () =>
          import('./pages/features/features.component').then((m) => m.FeaturesComponent),
        data: seo({
          title: 'Features',
          path: 'features',
          description:
            'Drawing tools, frame & layer animation, image-to-pixel conversion, color tools and PNG / project export — everything in Pixel Art Studio.',
        }),
      },
      {
        path: 'pricing',
        loadComponent: () =>
          import('./pages/pricing/pricing.component').then((m) => m.PricingComponent),
        data: seo({
          title: 'Pricing',
          path: 'pricing',
          description: 'Pixel Art Studio is free forever. See the optional Pro and Team plans.',
        }),
      },
      {
        path: 'about',
        loadComponent: () => import('./pages/about/about.component').then((m) => m.AboutComponent),
        data: seo({
          title: 'About',
          path: 'about',
          description:
            'Why we built a serious, local-first pixel art editor that runs in the browser.',
        }),
      },
      {
        path: 'guide',
        loadComponent: () => import('./pages/guide/guide.component').then((m) => m.GuideComponent),
        data: seo({
          title: 'Guide',
          path: 'guide',
          description:
            'How to use Pixel Art Studio — tools, layers, animation, palettes, import, export and keyboard shortcuts.',
        }),
      },
      {
        path: 'faq',
        loadComponent: () => import('./pages/faq/faq.component').then((m) => m.FaqComponent),
        data: seo({
          title: 'FAQ',
          path: 'faq',
          description: 'Answers to common questions about using Pixel Art Studio.',
        }),
      },
      {
        path: 'contact',
        loadComponent: () =>
          import('./pages/contact/contact.component').then((m) => m.ContactComponent),
        data: seo({
          title: 'Contact',
          path: 'contact',
          description: 'Questions, feedback or feature requests? Get in touch with the team.',
        }),
      },
      {
        path: 'blog',
        loadComponent: () =>
          import('./pages/blog/blog-list.component').then((m) => m.BlogListComponent),
        data: seo({
          title: 'Blog',
          path: 'blog',
          description: 'Tutorials and tips for drawing, animating and exporting pixel art.',
        }),
      },
      {
        path: 'blog/:slug',
        loadComponent: () =>
          import('./pages/blog/blog-post.component').then((m) => m.BlogPostComponent),
        // BlogPostComponent sets SEO per post.
        data: { skipSeo: true },
      },
      {
        // 404 — kept inside the layout so it retains the header/footer.
        path: '**',
        loadComponent: () =>
          import('./pages/not-found/not-found.component').then((m) => m.NotFoundComponent),
        data: seo({ title: 'Page not found', path: '404', noIndex: true }),
      },
    ],
  },
];
