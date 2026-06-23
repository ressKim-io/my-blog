'use client';

import { useState, useMemo } from 'react';
import Link from './Link';
import CategoryNav from './CategoryNav';

// 홈 피드 전용 경량 글 타입 — PostData의 content(본문 전문)를 클라이언트로 넘기지 않는다
export interface FeedPost {
  slug: string;
  title: string;
  category: string;
  date: string;
}

interface HomeCategoryFeedProps {
  posts: FeedPost[];
  categories: { name: string; label: string; count: number }[];
  limit?: number;
}

const categoryLabels: Record<string, string> = {
  istio: 'Istio',
  kubernetes: 'Kubernetes',
  challenge: 'Challenge',
  argocd: 'ArgoCD',
  monitoring: 'Monitoring',
  cicd: 'CI/CD',
  network: 'Network',
  rust: 'Rust',
};

export default function HomeCategoryFeed({ posts, categories, limit = 8 }: HomeCategoryFeedProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const shown = useMemo(() => {
    const filtered = selected ? posts.filter((p) => p.category === selected) : posts;
    return filtered.slice(0, limit);
  }, [posts, selected, limit]);

  const allHref = selected ? `/essays/?category=${selected}` : '/essays/';

  return (
    <div>
      <CategoryNav
        categories={categories}
        selected={selected}
        onSelect={setSelected}
        totalCount={posts.length}
      />

      <ul className="mt-6 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated)]">
        {shown.map((post, i) => (
          <li key={post.slug}>
            <Link
              href={`/essays/${post.slug}/`}
              className={`group flex items-baseline gap-4 px-5 py-4 transition-colors hover:bg-[var(--surface)] ${
                i > 0 ? 'border-t border-[var(--border)]' : ''
              }`}
            >
              <span className="hidden sm:block shrink-0 w-[96px] text-[12px] text-[var(--muted)]">
                {categoryLabels[post.category] ?? post.category}
              </span>
              <span className="min-w-0 flex-1 text-[15px] leading-snug text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
                {post.title}
              </span>
              <span className="shrink-0 font-mono text-[12px] text-[var(--muted-soft)] tabular-nums">
                {post.date.replace(/-/g, '.')}
              </span>
            </Link>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-5 py-10 text-center text-[14px] text-[var(--muted)]">
            이 카테고리의 글이 없습니다
          </li>
        )}
      </ul>

      <div className="mt-4 text-right">
        <Link
          href={allHref}
          className="text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
        >
          전체 글 →
        </Link>
      </div>
    </div>
  );
}
