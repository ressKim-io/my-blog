'use client';

import { useEffect, useRef, useState } from 'react';

interface ShareButtonProps {
  title: string;
}

export default function ShareButton({ title }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUrl(window.location.href);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleClick = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* 사용자 취소 또는 미지원 — fallback */
      }
    }
    setOpen((v) => !v);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent */
    }
  };

  const tweetHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

  const itemCls =
    'flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-colors text-left rounded-md';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleClick}
        aria-label="공유"
        className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-44 p-1 bg-[var(--elevated)] border border-[var(--border)] rounded-lg shadow-lg z-30">
          <button onClick={copyLink} className={itemCls}>
            {copied ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-emerald-600">Link copied</span>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Copy link
              </>
            )}
          </button>
          <a
            href={tweetHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={itemCls}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
            </svg>
            Share on X
          </a>
        </div>
      )}
    </div>
  );
}
