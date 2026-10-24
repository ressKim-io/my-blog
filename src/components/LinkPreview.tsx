'use client';

import { useEffect, useRef, useState, type AnchorHTMLAttributes } from 'react';
import { usePostMeta } from './PostsIndexProvider';
import { slugFromHref } from '@/lib/slug';
import { withBasePath } from '@/lib/basePath';

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
const PREVIEW_WIDTH = 360;
const VIEWPORT_MARGIN = 12;

export default function LinkPreview({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  // 슬러그 추출은 basePath가 없는 원본 href 기준, 렌더링되는 href만 basePath를 붙입니다
  const slug = slugFromHref(href);
  const resolvedHref = withBasePath(href);
  const meta = usePostMeta(slug);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(
    () => () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnResize = () => setOpen(false);
    window.addEventListener('resize', closeOnResize);
    return () => window.removeEventListener('resize', closeOnResize);
  }, [open]);

  // 미리보기 데이터가 없으면 일반 a로
  if (!meta) {
    return (
      <a href={resolvedHref} {...props}>
        {children}
      </a>
    );
  }

  const computePosition = () => {
    if (!linkRef.current) return;
    const rect = linkRef.current.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const previewWidth = Math.min(PREVIEW_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2);
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, viewportWidth - previewWidth - VIEWPORT_MARGIN),
    ) + window.scrollX;
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

  return (
    <>
      <a
        ref={linkRef}
        href={resolvedHref}
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
          style={{
            position: 'absolute',
            top: position.top,
            left: position.left,
            width: PREVIEW_WIDTH,
            maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
          }}
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
