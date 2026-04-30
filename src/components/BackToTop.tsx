'use client';

import { useEffect, useState } from 'react';

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? scrolled / max : 0;
      setVisible(ratio > 0.25);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="맨 위로"
      className={`fixed bottom-6 right-6 z-30 w-11 h-11 rounded-full bg-[var(--elevated)] border border-[var(--border)] text-[var(--muted)] shadow-md hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all duration-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
      }`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="w-5 h-5 mx-auto"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    </button>
  );
}
