'use client';

import { useState } from 'react';

export default function MobileTOC({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="목차 열기"
        className="fixed bottom-6 left-6 z-30 w-11 h-11 rounded-full bg-[var(--elevated)] border border-[var(--border)] text-[var(--muted)] shadow-md hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors flex items-center justify-center lg:hidden"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h12M4 12h16M4 18h8" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="absolute bottom-0 left-0 right-0 bg-[var(--bg)] border-t border-[var(--border)] rounded-t-2xl max-h-[78vh] overflow-y-auto shadow-2xl"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest('a')) setOpen(false);
            }}
          >
            <div className="sticky top-0 flex items-center justify-between px-5 py-3 bg-[var(--bg)]/90 backdrop-blur border-b border-[var(--border)]">
              <span className="text-[14px] font-semibold text-[var(--text)]">목차</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="w-8 h-8 flex items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--surface)] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 space-y-6">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
