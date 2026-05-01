import Link from './Link';
import { MDXRemote } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import { mdxComponents } from './MDXComponents';
import TOC from './TOC';
import ReadingProgressBar from './ReadingProgressBar';
import BackToTop from './BackToTop';
import EditOnGitHub from './EditOnGitHub';
import ShareButton from './ShareButton';
import MobileTOC from './MobileTOC';
import { extractHeadings, type PostData, type Track } from '@/lib/posts';

interface PostDetailProps {
  post: PostData;
  allPosts: PostData[];
  seriesPosts: PostData[];
}

const trackColor: Record<Track, string> = {
  essays: 'var(--essays)',
  logs: 'var(--logs)',
};

const trackLabel: Record<Track, string> = {
  essays: 'Essays',
  logs: 'Logs',
};

const typeLabels: Record<string, string> = {
  troubleshooting: 'Troubleshooting',
  adr: 'ADR',
  concept: 'Concept',
  retrospective: 'Retrospective',
};

const categoryLabels: Record<string, string> = {
  istio: 'Istio',
  kubernetes: 'Kubernetes',
  challenge: 'Challenge',
  argocd: 'ArgoCD',
  monitoring: 'Monitoring',
  cicd: 'CI/CD',
};

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function PostDetail({ post, allPosts, seriesPosts }: PostDetailProps) {
  const headings = extractHeadings(post.content);
  const track = post.track;
  const accent = trackColor[track];

  const categoryLabel = categoryLabels[post.category] ?? post.category;
  const typeLabel = post.type ? typeLabels[post.type] : null;

  const currentSeriesIndex = post.series
    ? seriesPosts.findIndex((p) => p.slug === post.slug)
    : -1;
  const prevInSeries = currentSeriesIndex > 0 ? seriesPosts[currentSeriesIndex - 1] : null;
  const nextInSeries =
    currentSeriesIndex >= 0 && currentSeriesIndex < seriesPosts.length - 1
      ? seriesPosts[currentSeriesIndex + 1]
      : null;

  const recommended = allPosts
    .filter(
      (p) => p.slug !== post.slug && p.track === track && p.category === post.category,
    )
    .slice(0, 3);

  const siteUrl = 'https://resskim-io.github.io/my-blog';
  const canonicalUrl = `${siteUrl}/${post.track}/${post.slug}/`;
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: {
      '@type': 'Person',
      name: 'Ress',
      url: 'https://github.com/ressKim-io',
    },
    publisher: {
      '@type': 'Person',
      name: 'Ress',
      url: siteUrl,
    },
    url: canonicalUrl,
    articleSection: categoryLabel,
    keywords: post.tags?.join(', '),
    inLanguage: 'ko',
    timeRequired: `PT${post.readingTime}M`,
  };
  const jsonLd = JSON.stringify(articleSchema).replace(/</g, '\\u003c');

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <ReadingProgressBar />
      <BackToTop />
      <main className="pt-10 pb-20">
        <div className="max-w-[1100px] mx-auto px-5">
          <div className="grid lg:grid-cols-[minmax(0,720px)_220px] lg:gap-12 lg:justify-center">
            <article className="min-w-0">
              <Link
                href={`/${track}`}
                className="inline-flex items-center gap-2 text-[13px] mb-8 transition-opacity hover:opacity-70"
                style={{ color: accent }}
              >
                <span>←</span>
                <span className="font-medium">{trackLabel[track]}</span>
                {typeLabel && (
                  <>
                    <span className="text-[var(--border-strong)]">·</span>
                    <span className="text-[var(--muted)]">{typeLabel}</span>
                  </>
                )}
              </Link>

              <header className="mb-10">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <h1 className="text-[32px] md:text-[36px] font-bold leading-[1.2] tracking-tight text-[var(--text)] flex-1">
                    {post.title}
                  </h1>
                  <div className="shrink-0 -mt-1">
                    <ShareButton title={post.title} />
                  </div>
                </div>
                {post.excerpt && (
                  <p className="text-[17px] leading-relaxed text-[var(--muted)] mb-5">
                    {post.excerpt}
                  </p>
                )}
                <div className="flex items-center gap-3 text-[13px] text-[var(--muted)]">
                  <time>{formatDate(post.date)}</time>
                  <span className="text-[var(--border-strong)]">·</span>
                  <span>{categoryLabel}</span>
                  <span className="text-[var(--border-strong)]">·</span>
                  <span>{post.readingTime}분 읽기</span>
                  {post.series && (
                    <>
                      <span className="text-[var(--border-strong)]">·</span>
                      <span className="truncate">
                        {post.series.name} {post.series.order}/{seriesPosts.length}
                      </span>
                    </>
                  )}
                </div>
                {post.tags && post.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-5">
                    {post.tags.map((tag) => (
                      <Link
                        key={tag}
                        href={`/${track}?tag=${tag}`}
                        className="text-[12px] text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                      >
                        #{tag}
                      </Link>
                    ))}
                  </div>
                )}
              </header>

              <div className="prose">
                <MDXRemote
                  source={post.content}
                  components={mdxComponents}
                  options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
                />
              </div>

              <div className="mt-12 pt-6 border-t border-[var(--border)] flex items-center justify-between gap-3">
                <EditOnGitHub slug={post.slug} />
              </div>

              {(prevInSeries || nextInSeries) && post.series && (
                <nav className="mt-10">
                  <p className="text-[12px] text-[var(--muted)] uppercase tracking-wider mb-4">
                    {post.series.name} 시리즈
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {prevInSeries ? (
                      <Link
                        href={`/${prevInSeries.track}/${prevInSeries.slug}`}
                        className="group p-4 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
                      >
                        <span className="text-[12px] text-[var(--muted)]">← Previous</span>
                        <p className="mt-1.5 text-[14px] text-[var(--text)] line-clamp-2 group-hover:text-[var(--accent)] transition-colors">
                          {prevInSeries.title}
                        </p>
                      </Link>
                    ) : (
                      <span />
                    )}
                    {nextInSeries ? (
                      <Link
                        href={`/${nextInSeries.track}/${nextInSeries.slug}`}
                        className="group p-4 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition-colors text-right"
                      >
                        <span className="text-[12px] text-[var(--muted)]">Next →</span>
                        <p className="mt-1.5 text-[14px] text-[var(--text)] line-clamp-2 group-hover:text-[var(--accent)] transition-colors">
                          {nextInSeries.title}
                        </p>
                      </Link>
                    ) : (
                      <span />
                    )}
                  </div>
                </nav>
              )}

              {recommended.length > 0 && (
                <section className="mt-16 pt-8 border-t border-[var(--border)]">
                  <h2 className="text-[12px] text-[var(--muted)] uppercase tracking-wider mb-5">
                    같은 트랙의 다른 글
                  </h2>
                  <ul className="space-y-3">
                    {recommended.map((rec) => (
                      <li key={rec.slug}>
                        <Link
                          href={`/${rec.track}/${rec.slug}`}
                          className="group block py-2"
                        >
                          <span className="text-[15px] text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                            {rec.title}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </article>

            <aside className="hidden lg:block">
              <div className="sticky top-20 space-y-6">
                {headings.length > 0 && <TOC headings={headings} />}
                {post.series && seriesPosts.length > 1 && <SeriesSidebar post={post} seriesPosts={seriesPosts} />}
              </div>
            </aside>
          </div>
        </div>
      </main>
      {(headings.length > 0 || (post.series && seriesPosts.length > 1)) && (
        <MobileTOC>
          {headings.length > 0 && <TOC headings={headings} />}
          {post.series && seriesPosts.length > 1 && (
            <SeriesSidebar post={post} seriesPosts={seriesPosts} />
          )}
        </MobileTOC>
      )}
    </>
  );
}

function SeriesSidebar({ post, seriesPosts }: { post: PostData; seriesPosts: PostData[] }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--muted)] uppercase tracking-wider mb-3">
        {post.series?.name}
      </p>
      <ol className="space-y-1.5">
        {seriesPosts.map((p) => {
          const isCurrent = p.slug === post.slug;
          return (
            <li key={p.slug}>
              <Link
                href={`/${p.track}/${p.slug}`}
                className={`flex gap-2.5 text-[12.5px] leading-snug transition-colors ${
                  isCurrent
                    ? 'text-[var(--accent)] font-medium'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                <span className="tabular-nums shrink-0 w-4">{p.series?.order}.</span>
                <span className="line-clamp-2">{p.title}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
