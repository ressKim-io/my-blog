import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Link from '@/components/Link';
import SeriesCard from '@/components/SeriesCard';
import { getSearchIndex } from '@/lib/posts';
import { getAllSeries, getSeriesById, getSeriesIds } from '@/lib/series';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  return getSeriesIds().map((id) => ({ id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const series = getSeriesById(id);
  if (!series) return {};

  return {
    title: `${series.title} 시리즈`,
    description: series.blurb,
    alternates: { canonical: `/series/${id}/` },
    openGraph: {
      type: 'website',
      title: `${series.title} 시리즈`,
      description: series.blurb,
    },
  };
}

export default async function SeriesDetailPage({ params }: Props) {
  const { id } = await params;
  const series = getSeriesById(id);
  if (!series) notFound();

  const totalReading = series.posts.reduce((n, p) => n + p.readingTime, 0);
  const others = getAllSeries()
    .filter((s) => s.id !== id)
    .slice(0, 3);

  return (
    <>
      <Header posts={getSearchIndex()} />
      <main className="pt-10 pb-16">
        <div className="max-w-[760px] mx-auto px-5">
          <nav className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
            <Link href="/" className="hover:text-[var(--accent)] transition-colors">
              Home
            </Link>
            <span className="text-[var(--border-strong)]">/</span>
            <Link href="/series/" className="hover:text-[var(--accent)] transition-colors">
              Series
            </Link>
            <span className="text-[var(--border-strong)]">/</span>
            <span className="text-[var(--text)]">{series.title}</span>
          </nav>

          <header className="mt-6 pb-8 border-b border-[var(--border)]">
            <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--muted-soft)]">
              {series.tagline}
            </div>
            <h1 className="mt-3 text-[32px] md:text-[38px] font-bold tracking-tight leading-[1.2] text-[var(--text)]">
              {series.title} 시리즈
            </h1>
            <p className="mt-3 text-[16px] leading-relaxed text-[var(--muted)]">{series.blurb}</p>
            <div className="mt-5 flex items-center gap-3 text-[13px] text-[var(--muted)]">
              <span className="font-mono">{series.count}편</span>
              <span className="text-[var(--border-strong)]">·</span>
              <span className="font-mono">약 {totalReading}분</span>
            </div>
          </header>

          <ol className="mt-2">
            {series.posts.map((post, i) => (
              <li key={post.slug}>
                <Link
                  href={`/essays/${post.slug}/`}
                  className="group flex items-baseline gap-4 py-4 border-b border-[var(--border)]"
                >
                  <span className="shrink-0 font-mono text-[13px] text-[var(--muted-soft)] tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium leading-snug text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
                      {post.title}
                    </div>
                    {post.excerpt && (
                      <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)] line-clamp-1">
                        {post.excerpt}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[12px] text-[var(--muted-soft)]">
                    {post.readingTime}분
                  </span>
                </Link>
              </li>
            ))}
          </ol>

          {others.length > 0 && (
            <section className="mt-14">
              <h2 className="mb-5 text-[12px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                다른 시리즈
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {others.map((s) => (
                  <SeriesCard key={s.id} series={s} />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
