'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { PostData } from '@/lib/posts';
import type { SeriesGroup } from '@/lib/projects';

interface ProjectPostsViewProps {
  series: SeriesGroup[];
  standalone: PostData[];
}

const categoryLabels: Record<string, string> = {
  istio: 'Istio',
  kubernetes: 'Kubernetes',
  challenge: 'Challenge',
  argocd: 'ArgoCD',
  monitoring: 'Monitoring',
  cicd: 'CI/CD',
};

function formatDate(date: string) {
  return new Date(date).toISOString().slice(0, 10);
}

export default function ProjectPostsView({ series, standalone }: ProjectPostsViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view = (searchParams.get('view') === 'timeline' ? 'timeline' : 'series') as
    | 'series'
    | 'timeline';

  const setView = (v: 'series' | 'timeline') => {
    const params = new URLSearchParams(searchParams.toString());
    if (v === 'series') params.delete('view');
    else params.set('view', v);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const allPosts = useMemo(() => {
    const all = [...standalone];
    series.forEach((s) => all.push(...s.posts));
    return all.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [series, standalone]);

  const tabBase =
    'px-4 py-2 text-[13.5px] font-medium rounded-lg transition-colors';
  const tabActive = 'bg-[var(--text)] text-white';
  const tabIdle = 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]';

  return (
    <>
      <div className="flex items-center gap-1.5 mb-6">
        <button
          onClick={() => setView('series')}
          className={`${tabBase} ${view === 'series' ? tabActive : tabIdle}`}
        >
          Series · {series.length}
        </button>
        <button
          onClick={() => setView('timeline')}
          className={`${tabBase} ${view === 'timeline' ? tabActive : tabIdle}`}
        >
          Timeline · {allPosts.length}
        </button>
      </div>

      {view === 'series' ? (
        <SeriesView series={series} standalone={standalone} />
      ) : (
        <TimelineView posts={allPosts} />
      )}
    </>
  );
}

function SeriesView({ series, standalone }: { series: SeriesGroup[]; standalone: PostData[] }) {
  return (
    <>
      {series.length > 0 && (
        <section className="mb-12">
          <h2 className="text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-5">
            Series — {series.length}개
          </h2>
          <div className="space-y-2">
            {series.map((s) => (
              <details
                key={s.name}
                className="group rounded-lg border border-[var(--border)] bg-[var(--elevated)] open:bg-[var(--surface)] transition-colors"
              >
                <summary className="flex items-center justify-between gap-3 p-4 cursor-pointer list-none">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[12px] text-[var(--muted)] transition-transform group-open:rotate-90">
                      ▸
                    </span>
                    <span className="text-[16px] font-semibold text-[var(--text)] truncate">
                      {s.name}
                    </span>
                  </div>
                  <span className="text-[13px] text-[var(--muted)] tabular-nums shrink-0">
                    {s.posts.length}편
                  </span>
                </summary>
                <ol className="px-4 pb-4 pt-1 space-y-1">
                  {s.posts.map((p) => (
                    <li key={p.slug}>
                      <Link
                        href={`/${p.track}/${p.slug}`}
                        className="group/item flex items-baseline gap-3 py-2 px-2 -mx-2 rounded hover:bg-[var(--bg)] transition-colors"
                      >
                        <span className="text-[13px] text-[var(--muted)] tabular-nums shrink-0 w-6">
                          {p.series?.order}.
                        </span>
                        <span className="text-[15px] text-[var(--text-secondary)] group-hover/item:text-[var(--accent)] transition-colors flex-1 leading-snug">
                          {p.title}
                        </span>
                        <span
                          className="text-[11px] uppercase tracking-wider tabular-nums shrink-0"
                          style={{
                            color: p.track === 'logs' ? 'var(--logs)' : 'var(--muted-soft)',
                          }}
                        >
                          {p.track === 'logs' ? 'log' : 'essay'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        </section>
      )}

      {standalone.length > 0 && (
        <section>
          <h2 className="text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-5">
            단독 글 — 시리즈 외 {standalone.length}편
          </h2>
          <ul className="divide-y divide-[var(--border)]">
            {standalone.map((p) => (
              <li key={p.slug}>
                <PostLine post={p} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function TimelineView({ posts }: { posts: PostData[] }) {
  // 월별 그룹
  const grouped = useMemo(() => {
    const map = new Map<string, PostData[]>();
    posts.forEach((p) => {
      const month = p.date.slice(0, 7);
      const arr = map.get(month) ?? [];
      arr.push(p);
      map.set(month, arr);
    });
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [posts]);

  return (
    <section>
      {grouped.map(([month, items]) => (
        <div key={month} className="mb-8">
          <h3 className="text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-3 sticky top-14 bg-[var(--bg)]/85 backdrop-blur-md py-2 -mx-1 px-1">
            {month}
          </h3>
          <ul className="divide-y divide-[var(--border)]">
            {items.map((p) => (
              <li key={p.slug}>
                <PostLine post={p} showSeries />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function PostLine({ post, showSeries = false }: { post: PostData; showSeries?: boolean }) {
  return (
    <Link
      href={`/${post.track}/${post.slug}`}
      className="group flex items-baseline gap-3 py-3.5 hover:bg-[var(--surface)] -mx-3 px-3 rounded transition-colors"
    >
      <time className="text-[13px] text-[var(--muted-soft)] tabular-nums shrink-0 w-[92px]">
        {formatDate(post.date)}
      </time>
      <span
        className="text-[11px] uppercase tracking-wider tabular-nums shrink-0 w-[42px]"
        style={{ color: post.track === 'logs' ? 'var(--logs)' : 'var(--muted-soft)' }}
      >
        {post.track === 'logs' ? 'log' : 'essay'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[16px] text-[var(--text)] group-hover:text-[var(--accent)] transition-colors leading-snug">
          {post.title}
        </div>
        {showSeries && post.series && (
          <div className="text-[13px] text-[var(--muted)] mt-1">
            {post.series.name} {post.series.order}
            <span className="mx-1.5 text-[var(--border-strong)]">·</span>
            {categoryLabels[post.category] ?? post.category}
          </div>
        )}
      </div>
    </Link>
  );
}
