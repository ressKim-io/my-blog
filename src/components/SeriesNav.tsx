import Link from 'next/link';

interface SeriesPost {
  slug: string;
  title: string;
  series?: {
    name: string;
    order: number;
  };
}

interface SeriesNavProps {
  seriesName: string;
  currentOrder: number;
  posts: SeriesPost[];
  showList?: boolean;
}

export default function SeriesNav({
  seriesName,
  currentOrder,
  posts,
  showList = true,
}: SeriesNavProps) {
  const seriesDisplayName = seriesName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const currentIndex = posts.findIndex(p => p.series?.order === currentOrder);
  const prevPost = currentIndex > 0 ? posts[currentIndex - 1] : null;
  const nextPost = currentIndex < posts.length - 1 ? posts[currentIndex + 1] : null;

  return (
    <div className="my-8 border border-[var(--border)] rounded-lg overflow-hidden">
      {/* 시리즈 헤더 */}
      <div className="bg-[var(--bg-secondary)] px-4 py-3 flex items-center gap-2">
        <span className="text-lg">📚</span>
        <span className="font-semibold text-[var(--text-primary)]">{seriesDisplayName} 시리즈</span>
        <span className="ml-auto text-sm text-[var(--text-muted)]">
          {currentOrder} / {posts.length}
        </span>
      </div>

      {/* 시리즈 목록 */}
      {showList && (
        <div className="px-4 py-3 space-y-2">
          {posts.map((post, index) => {
            const order = post.series?.order || index + 1;
            const isCurrent = order === currentOrder;
            const isPast = order < currentOrder;

            return (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className={`
                  flex items-center gap-3 py-2 px-3 rounded-lg transition-colors
                  ${isCurrent
                    ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'hover:bg-[var(--bg-tertiary)]'}
                `}
              >
                <span className={`
                  flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium
                  ${isPast
                    ? 'bg-green-500/20 text-green-400'
                    : isCurrent
                      ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}
                `}>
                  {isPast ? '✓' : order}
                </span>
                <span className={`
                  flex-1 text-sm
                  ${isCurrent ? 'font-medium' : 'text-[var(--text-secondary)]'}
                `}>
                  {post.title.replace(/^\[.*?\]\s*/, '')}
                </span>
                {isCurrent && (
                  <span className="text-xs text-[var(--accent)]">현재</span>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* 이전/다음 네비게이션 */}
      <div className="border-t border-[var(--border)] px-4 py-3 flex justify-between">
        {prevPost ? (
          <Link
            href={`/blog/${prevPost.slug}`}
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <span>←</span>
            <span className="max-w-[150px] truncate">이전: {prevPost.title.replace(/^\[.*?\]\s*/, '')}</span>
          </Link>
        ) : (
          <span></span>
        )}

        {nextPost ? (
          <Link
            href={`/blog/${nextPost.slug}`}
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <span className="max-w-[150px] truncate">다음: {nextPost.title.replace(/^\[.*?\]\s*/, '')}</span>
            <span>→</span>
          </Link>
        ) : (
          <span className="text-sm text-[var(--text-muted)]">시리즈 완료! 🎉</span>
        )}
      </div>
    </div>
  );
}
