import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { POSTS } from './posts.data';
import { TranslatePipe } from '../../i18n/translate.pipe';

@Component({
  selector: 'app-blog-list',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  template: `
    <section class="section-tight page-hero">
      <div class="container narrow">
        <span class="eyebrow">{{ 'blog.eyebrow' | t }}</span>
        <h1 class="h-xl">{{ 'blog.heroTitle' | t }}</h1>
        <p class="lead">{{ 'blog.heroLead' | t }}</p>
      </div>
    </section>

    <section class="section-tight">
      <div class="container narrow">
        <ul class="posts">
          <li *ngFor="let p of posts">
            <a class="card card-hover post" [routerLink]="['/blog', p.slug]">
              <div class="meta">
                <time [attr.datetime]="p.date">{{ p.date | date: 'mediumDate' }}</time>
                <span>·</span>
                <span>{{ 'blog.minRead' | t: { mins: p.readMins } }}</span>
              </div>
              <h2>{{ p.titleKey | t }}</h2>
              <p>{{ p.excerptKey | t }}</p>
              <div class="tags">
                <span class="tag" *ngFor="let tk of p.tagKeys">{{ tk | t }}</span>
              </div>
            </a>
          </li>
        </ul>
      </div>
    </section>
  `,
  styles: [
    `
      .page-hero { padding-top: 56px; }
      .narrow { max-width: 760px; }
      .page-hero h1 { margin: 6px 0 12px; }
      .posts { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 18px; }
      .post { display: block; transition: border-color 0.15s, transform 0.12s; }
      .post:hover { border-color: var(--brand); transform: translateY(-2px); }
      .meta { display: flex; gap: 8px; color: var(--text-dim); font-size: 13px; margin-bottom: 8px; }
      .post h2 { font-size: 21px; margin-bottom: 8px; }
      .post p { color: var(--text-muted); line-height: 1.6; margin: 0 0 14px; }
      .tags { display: flex; gap: 8px; flex-wrap: wrap; }
      .tag { font-size: 12px; color: var(--brand); background: rgba(31,138,124,0.12); border: 1px solid rgba(31,138,124,0.3); padding: 3px 9px; border-radius: 999px; }
    `,
  ],
})
export class BlogListComponent {
  readonly posts = [...POSTS].sort((a, b) => b.date.localeCompare(a.date));
}
