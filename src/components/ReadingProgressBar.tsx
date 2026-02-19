'use client';

import { useEffect, useRef, useState } from 'react';

export default function ReadingProgressBar() {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);
  const ticking = useRef(false);

  useEffect(() => {
    const updateProgress = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        setProgress(Math.min((scrollTop / docHeight) * 100, 100));
      }
      ticking.current = false;
    };

    const onScroll = () => {
      if (!ticking.current) {
        rafRef.current = requestAnimationFrame(updateProgress);
        ticking.current = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="fixed top-14 left-0 right-0 z-50 h-[2px] bg-transparent">
      <div
        className="h-full bg-[var(--accent)] transition-none"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
