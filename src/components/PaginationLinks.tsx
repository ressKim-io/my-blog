'use client';

import Link from './Link';
import { useSearchParams, usePathname } from 'next/navigation';

interface PaginationLinksProps {
  currentPage: number;
  totalPages: number;
}

export default function PaginationLinks({ currentPage, totalPages }: PaginationLinksProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  if (totalPages <= 1) return null;

  const buildHref = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page === 1) params.delete('page');
    else params.set('page', String(page));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  const baseBtn = 'min-w-[36px] h-9 px-2 text-[14px] rounded-lg flex items-center justify-center transition-colors';
  const inactive = 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]';
  const active = 'bg-[var(--accent)] text-white';
  const disabled = 'text-[var(--muted)] opacity-30 pointer-events-none';

  return (
    <nav className="flex items-center justify-center gap-1 mt-12">
      {currentPage > 1 ? (
        <Link href={buildHref(currentPage - 1)} className={`${baseBtn} ${inactive}`} aria-label="Previous">
          ‹
        </Link>
      ) : (
        <span className={`${baseBtn} ${disabled}`}>‹</span>
      )}
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`dots-${i}`} className="px-1 text-[var(--muted)] text-[14px]">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={buildHref(p)}
            className={`${baseBtn} ${p === currentPage ? active : inactive}`}
            aria-current={p === currentPage ? 'page' : undefined}
          >
            {p}
          </Link>
        )
      )}
      {currentPage < totalPages ? (
        <Link href={buildHref(currentPage + 1)} className={`${baseBtn} ${inactive}`} aria-label="Next">
          ›
        </Link>
      ) : (
        <span className={`${baseBtn} ${disabled}`}>›</span>
      )}
    </nav>
  );
}
