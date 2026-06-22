export interface BlogPost {
  slug: string;
  /** i18n key resolved via the Translate pipe. */
  titleKey: string;
  date: string; // ISO
  readMins: number;
  /** i18n key resolved via the Translate pipe. */
  excerptKey: string;
  /** i18n keys for tag labels. */
  tagKeys: string[];
  /** i18n key for the simple HTML body (trusted, authored content). */
  bodyKey: string;
}

export const POSTS: BlogPost[] = [
  {
    slug: 'getting-started-with-pixel-art',
    titleKey: 'blogpost.post1.title',
    date: '2026-05-20',
    readMins: 5,
    excerptKey: 'blogpost.post1.excerpt',
    tagKeys: ['blogpost.tag.tutorial', 'blogpost.tag.basics'],
    bodyKey: 'blogpost.post1.body',
  },
  {
    slug: 'animating-sprites-frame-by-frame',
    titleKey: 'blogpost.post2.title',
    date: '2026-05-27',
    readMins: 6,
    excerptKey: 'blogpost.post2.excerpt',
    tagKeys: ['blogpost.tag.animation', 'blogpost.tag.tutorial'],
    bodyKey: 'blogpost.post2.body',
  },
  {
    slug: 'turn-photos-into-pixel-art',
    titleKey: 'blogpost.post3.title',
    date: '2026-06-02',
    readMins: 4,
    excerptKey: 'blogpost.post3.excerpt',
    tagKeys: ['blogpost.tag.imageConvert', 'blogpost.tag.tips'],
    bodyKey: 'blogpost.post3.body',
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}
