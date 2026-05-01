import Link from './Link';
import type { PostData, Track } from '@/lib/posts';

interface PostCardProps {
  post: PostData;
  track: Track;
  variant?: 'card' | 'line';
  showExcerpt?: boolean;
}

const categoryLabels: Record<string, string> = {
  istio: 'Istio',
  kubernetes: 'Kubernetes',
  challenge: 'Challenge',
  argocd: 'ArgoCD',
  monitoring: 'Monitoring',
  cicd: 'CI/CD',
};

const typeLabels: Record<string, string> = {
  troubleshooting: 'Troubleshooting',
  adr: 'ADR',
  concept: 'Concept',
  retrospective: 'Retro',
};

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(date: string) {
  return new Date(date).toISOString().slice(0, 10);
}

export default function PostCard({ post, track, variant = 'card', showExcerpt = true }: PostCardProps) {
  const href = `/${track}/${post.slug}`;
  const categoryLabel = categoryLabels[post.category] ?? post.category;
  const typeLabel = post.type ? typeLabels[post.type] : null;

  if (variant === 'line') {
    return (
      <Link
        href={href}
        className="group flex items-baseline gap-4 py-3.5 border-b border-[var(--border)] hover:bg-[var(--surface)] -mx-3 px-3 rounded transition-colors"
      >
        <time className="text-[12px] text-[var(--muted-soft)] tabular-nums shrink-0 w-[88px]">
          {formatDateShort(post.date)}
        </time>
        <span className="text-[12px] text-[var(--muted)] shrink-0 w-[96px]">{categoryLabel}</span>
        <span className="text-[15px] text-[var(--text)] group-hover:text-[var(--accent)] transition-colors leading-snug min-w-0">
          {post.title}
        </span>
      </Link>
    );
  }

  return (
    <Link href={href} className="group block py-7 border-b border-[var(--border)]">
      <div className="flex items-center gap-2.5 mb-2.5 text-[12px] text-[var(--muted)]">
        {typeLabel && <span className="font-medium">{typeLabel}</span>}
        {typeLabel && <span className="text-[var(--border-strong)]">·</span>}
        <span>{categoryLabel}</span>
        <span className="text-[var(--border-strong)]">·</span>
        <time>{formatDate(post.date)}</time>
        <span className="text-[var(--border-strong)]">·</span>
        <span>{post.readingTime}분</span>
        {post.series && (
          <>
            <span className="text-[var(--border-strong)]">·</span>
            <span className="truncate">
              {post.series.name} {post.series.order}
            </span>
          </>
        )}
      </div>
      <h3 className="text-[19px] font-semibold text-[var(--text)] group-hover:text-[var(--accent)] transition-colors leading-snug mb-2 tracking-tight">
        {post.title}
      </h3>
      {showExcerpt && post.excerpt && (
        <p className="text-[14.5px] text-[var(--muted)] leading-relaxed line-clamp-2">
          {post.excerpt}
        </p>
      )}
    </Link>
  );
}
