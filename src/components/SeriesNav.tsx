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
      {/* Series Header */}
      <div className="bg-[var(--bg-secondary)] px-4 py-3 flex items-center justify-between">
        <span className="font-medium text-sm text-[var(--text-primary)]">{seriesDisplayName} Series</span>
        <span className="text-xs text-[var(--text-muted)]">
          {currentOrder} / {posts.length}
        </span>
      </div>

      {/* Series List */}
      {showList && (
        <div className="px-4 py-3 space-y-1">
          {posts.map((post, index) => {
            const order = post.series?.order || index + 1;
            const isCurrent = order === currentOrder;
            const isPast = order < currentOrder;

            return (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className={`flex items-center gap-3 py-2 px-3 rounded-lg text-sm transition-colors ${
                  isCurrent
                    ? 'bg-[var(--accent-muted)] text-[var(--accent)]'
                    : 'hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <span className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${
                  isPast
                    ? 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                    : isCurrent
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                }`}>
                  {isPast ? '✓' : order}
                </span>
                <span className={`flex-1 ${isCurrent ? 'font-medium' : 'text-[var(--text-secondary)]'}`}>
                  {post.title.replace(/^\[.*?\]\s*/, '')}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Prev/Next Navigation */}
      <div className="border-t border-[var(--border)] px-4 py-3 flex justify-between">
        {prevPost ? (
          <Link
            href={`/blog/${prevPost.slug}`}
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <span>←</span>
            <span className="max-w-[150px] truncate">Prev</span>
          </Link>
        ) : (
          <span />
        )}

        {nextPost ? (
          <Link
            href={`/blog/${nextPost.slug}`}
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <span className="max-w-[150px] truncate">Next</span>
            <span>→</span>
          </Link>
        ) : (
          <span className="text-sm text-[var(--text-muted)]">Series complete</span>
        )}
      </div>
    </div>
  );
}
