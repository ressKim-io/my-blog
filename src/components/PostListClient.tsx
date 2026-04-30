'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import PostCard from './PostCard';
import CategoryFilter from './CategoryFilter';
import PaginationLinks from './PaginationLinks';
import type { PostData, Track } from '@/lib/posts';

interface PostListClientProps {
  posts: PostData[];
  track: Track;
  categories: { name: string; label: string; count: number }[];
  variant?: 'card' | 'line';
  perPage?: number;
}

export default function PostListClient({
  posts,
  track,
  categories,
  variant = 'card',
  perPage = 12,
}: PostListClientProps) {
  const searchParams = useSearchParams();
  const category = searchParams.get('category');
  const tag = searchParams.get('tag');
  const pageParam = parseInt(searchParams.get('page') ?? '1', 10);

  const filtered = useMemo(() => {
    let result = posts;
    if (category) result = result.filter((p) => p.category === category);
    if (tag) result = result.filter((p) => p.tags?.includes(tag));
    return result;
  }, [posts, category, tag]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(Math.max(1, pageParam || 1), totalPages);
  const start = (safePage - 1) * perPage;
  const pageItems = filtered.slice(start, start + perPage);

  return (
    <>
      <CategoryFilter categories={categories} totalCount={posts.length} />

      {tag && (
        <div className="flex items-center gap-2 mb-6 text-[13px]">
          <span className="text-[var(--muted)]">Tag:</span>
          <span className="px-2.5 py-0.5 rounded-full bg-[var(--accent)] text-white">
            #{tag}
          </span>
          <span className="text-[var(--muted)]">{filtered.length}편</span>
        </div>
      )}

      {pageItems.length === 0 ? (
        <p className="py-16 text-center text-[var(--muted)]">조건에 해당하는 글이 없습니다.</p>
      ) : (
        <div>
          {pageItems.map((post) => (
            <PostCard key={post.slug} post={post} track={track} variant={variant} />
          ))}
        </div>
      )}

      <PaginationLinks currentPage={safePage} totalPages={totalPages} />
    </>
  );
}
