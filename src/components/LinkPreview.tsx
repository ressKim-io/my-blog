'use client';

import { useEffect, useRef, useState, type AnchorHTMLAttributes } from 'react';
import { usePostMeta } from './PostsIndexProvider';
import { slugFromHref } from '@/lib/slug';

const trackLabel = {
  essays: 'Essay',
  logs: 'Log',
  projects: 'Project',
} as const;

const trackColor = {
  essays: 'var(--essays)',
  logs: 'var(--logs)',
  projects: 'var(--projects)',
} as const;

const typeLabel: Record<string, string> = {
  troubleshooting: 'Troubleshooting',
  adr: 'ADR',
  concept: 'Concept',
  retrospective: 'Retrospective',
};

const HOVER_DELAY = 220;
const HIDE_DELAY = 160;

export default function LinkPreview({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const slug = slugFromHref(href);
  const meta = usePostMeta(slug);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // 미리보기 데이터가 없으면 일반 a로
  if (!meta) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  const computePosition = () => {
    if (!linkRef.current) return;
    const rect = linkRef.current.getBoundingClientRect();
    const previewWidth = 360;
    const margin = 12;
    let left = rect.left + window.scrollX;
    if (left + previewWidth + margin > window.innerWidth) {
      left = window.innerWidth - previewWidth - margin;
    }
    if (left < margin) left = margin;
    setPosition({ top: rect.bottom + window.scrollY + 8, left });
  };

  const cancelTimers = () => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const scheduleShow = () => {
    cancelTimers();
    showTimer.current = setTimeout(() => {
      computePosition();
      setOpen(true);
    }, HOVER_DELAY);
  };

  const scheduleHide = () => {
    cancelTimers();
    hideTimer.current = setTimeout(() => setOpen(false), HIDE_DELAY);
  };

  useEffect(() => () => cancelTimers(), []);

  return (
    <>
      <a
        ref={linkRef}
        href={href}
        onMouseEnter={scheduleShow}
        onMouseLeave={scheduleHide}
        onFocus={scheduleShow}
        onBlur={scheduleHide}
        {...props}
      >
        {children}
      </a>
      {open && position && (
        <div
          role="tooltip"
          onMouseEnter={cancelTimers}
          onMouseLeave={scheduleHide}
          style={{ position: 'absolute', top: position.top, left: position.left, width: 360 }}
          className="z-40 p-4 bg-[var(--elevated)] border border-[var(--border)] rounded-lg shadow-xl pointer-events-auto animate-in fade-in"
        >
          <div className="flex items-center gap-2 mb-2 text-[11px] font-medium uppercase tracking-wider">
            <span style={{ color: trackColor[meta.track] }}>{trackLabel[meta.track]}</span>
            {meta.type && (
              <>
                <span className="text-[var(--border-strong)]">·</span>
                <span className="text-[var(--muted)]">{typeLabel[meta.type] ?? meta.type}</span>
              </>
            )}
            <span className="text-[var(--border-strong)]">·</span>
            <span className="text-[var(--muted)] tabular-nums">{meta.readingTime}분</span>
            <span className="text-[var(--border-strong)]">·</span>
            <time className="text-[var(--muted)] tabular-nums">{meta.date.slice(0, 10)}</time>
          </div>
          <h4 className="text-[15px] font-semibold text-[var(--text)] leading-snug mb-1.5">
            {meta.title}
          </h4>
          {meta.excerpt && (
            <p className="text-[13px] text-[var(--muted)] leading-relaxed line-clamp-3">
              {meta.excerpt}
            </p>
          )}
        </div>
      )}
    </>
  );
}
