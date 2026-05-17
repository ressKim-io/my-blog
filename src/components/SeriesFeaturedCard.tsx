import Link from './Link';
import type { SeriesWithPosts } from '@/lib/series';

export default function SeriesFeaturedCard({ series }: { series: SeriesWithPosts }) {
  const top3 = series.posts.slice(0, 3);

  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--elevated)] p-6 md:p-7">
      <div className="flex items-center justify-between">
        <span className="rounded bg-[var(--accent-soft)] px-2 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--accent)]">
          Featured
        </span>
        <span className="font-mono text-[12px] text-[var(--muted)]">{series.count}편</span>
      </div>

      <h3 className="mt-5 text-[26px] font-bold tracking-tight text-[var(--text)]">{series.title}</h3>
      <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--muted)]">{series.blurb}</p>

      <div className="my-5 h-px bg-[var(--border)]" />

      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--muted-soft)]">대표 글</div>
      <ul className="mt-3 flex flex-col gap-2.5">
        {top3.map((post, i) => (
          <li key={post.slug}>
            <Link
              href={`/essays/${post.slug}/`}
              className="group flex gap-2.5 text-[14px] leading-snug text-[var(--text-secondary)]"
            >
              <span className="shrink-0 font-mono text-[11px] text-[var(--muted-soft)]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="transition-colors group-hover:text-[var(--accent)]">{post.title}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-6">
        <Link
          href={`/series/${series.id}/`}
          className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
        >
          {series.title} 시리즈 보기 <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
