import Link from './Link';
import type { SeriesWithPosts } from '@/lib/series';

interface SeriesCardProps {
  series: SeriesWithPosts;
  variant?: 'default' | 'rail';
}

export default function SeriesCard({ series, variant = 'default' }: SeriesCardProps) {
  return (
    <Link
      href={`/series/${series.id}/`}
      className={`group flex flex-col rounded-xl border border-[var(--border)] bg-[var(--elevated)] p-5 transition-colors hover:border-[var(--accent)] ${
        variant === 'rail' ? 'snap-start shrink-0 w-[270px]' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[16px] font-bold tracking-tight text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
          {series.title}
        </h3>
        <span className="shrink-0 font-mono text-[11px] text-[var(--muted)]">{series.count}편</span>
      </div>
      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--muted-soft)]">
        {series.tagline}
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--muted)]">{series.blurb}</p>
      <div className="mt-auto pt-4">
        <div className="border-t border-dashed border-[var(--border)] pt-3 text-[12px] text-[var(--muted)]">
          대표 <span className="text-[var(--text-secondary)]">{series.posts[0].title}</span>
        </div>
      </div>
    </Link>
  );
}
