'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

interface Heading {
  id: string;
  text: string;
  level: number;
}

interface TOCProps {
  headings: Heading[];
}

export default function TOC({ headings }: TOCProps) {
  const [activeId, setActiveId] = useState<string>('');
  const pendingId = useRef<string>('');
  const rafRef = useRef<number>(0);

  const scheduleUpdate = useCallback((id: string) => {
    pendingId.current = id;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        setActiveId(pendingId.current);
        rafRef.current = 0;
      });
    }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            scheduleUpdate(entry.target.id);
          }
        }
      },
      { rootMargin: '-72px 0px -80% 0px' }
    );

    headings.forEach((heading) => {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [headings, scheduleUpdate]);

  if (headings.length === 0) return null;

  return (
    <nav className="text-xs">
      <ul className="space-y-1.5">
        {headings.map((heading) => (
          <li key={heading.id} className={heading.level === 3 ? 'ml-3' : ''}>
            <a
              href={`#${heading.id}`}
              className={`
                block py-0.5 transition-colors leading-snug
                ${activeId === heading.id
                  ? 'text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }
              `}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
