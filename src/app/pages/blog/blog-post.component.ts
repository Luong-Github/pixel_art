import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SITE } from '../../core/seo/seo.data';
import { SeoService } from '../../core/seo/seo.service';
import { BlogPost, getPost } from './posts.data';

@Component({
  selector: 'app-blog-post',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article class="section-tight" *ngIf="post">
      <div class="container narrow">
        <a routerLink="/blog" class="back">← All posts</a>
        <div class="meta">
          <time [attr.datetime]="post.date">{{ post.date | date: 'mediumDate' }}</time>
          <span>·</span><span>{{ post.readMins }} min read</span>
        </div>
        <h1 class="h-xl">{{ post.title }}</h1>
        <div class="tags">
          <span class="tag" *ngFor="let t of post.tags">{{ t }}</span>
        </div>
        <div class="body" [innerHTML]="post.body"></div>

        <div class="cta card">
          <h2 class="h-lg">Try it yourself</h2>
          <p>Open the studio and put this into practice.</p>
          <a routerLink="/editor" class="btn btn-primary btn-lg">Launch the app →</a>
        </div>
      </div>
    </article>
  `,
  styles: [
    `
      .narrow { max-width: 720px; }
      .back { color: var(--brand); font-size: 14px; display: inline-block; margin-bottom: 18px; }
      .meta { display: flex; gap: 8px; color: var(--text-dim); font-size: 13px; margin-bottom: 10px; }
      h1 { margin-bottom: 14px; }
      .tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 28px; }
      .tag { font-size: 12px; color: var(--brand); background: rgba(31,138,124,0.12); border: 1px solid rgba(31,138,124,0.3); padding: 3px 9px; border-radius: 999px; }
      .body { color: var(--text-muted); font-size: 16.5px; line-height: 1.8; }
      .body ::ng-deep h2 { color: var(--text); font-size: 22px; margin: 32px 0 12px; }
      .body ::ng-deep p { margin: 0 0 18px; }
      .body ::ng-deep code { background: var(--surface-2); border: 1px solid var(--border); padding: 1px 6px; border-radius: 6px; font-size: 14px; }
      .cta { text-align: center; margin-top: 48px; }
      .cta p { color: var(--text-muted); margin: 10px 0 22px; }
    `,
  ],
})
export class BlogPostComponent implements OnInit {
  post?: BlogPost;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug') ?? '';
      const post = getPost(slug);
      if (!post) {
        this.router.navigate(['/blog']);
        return;
      }
      this.post = post;
      this.seo.setPage({
        title: post.title,
        description: post.excerpt,
        path: `blog/${post.slug}`,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.title,
          description: post.excerpt,
          datePublished: post.date,
          keywords: post.tags.join(', '),
          author: { '@type': 'Organization', name: SITE.name },
          publisher: { '@type': 'Organization', name: SITE.name },
          mainEntityOfPage: `${SITE.url}/blog/${post.slug}`,
        },
      });
    });
  }
}
