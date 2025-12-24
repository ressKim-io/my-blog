'use client';

import { useEffect, useState } from 'react';

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

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: '-80px 0px -80% 0px' }
    );

    headings.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) {
    return (
      <nav className="text-sm">
        <h4 className="text-[var(--text-primary)] font-semibold mb-4">목차</h4>
        <p className="text-[var(--text-muted)]">목차가 없습니다</p>
      </nav>
    );
  }

  return (
    <nav className="text-sm">
      <h4 className="text-[var(--text-primary)] font-semibold mb-4 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
        </svg>
        목차
      </h4>

      <ul className="space-y-2">
        {headings.map((heading) => (
          <li key={heading.id} className={heading.level === 3 ? 'ml-4' : ''}>
            <a
              href={`#${heading.id}`}
              className={`
                toc-link block py-1 transition-colors relative
                ${activeId === heading.id
                  ? 'text-[var(--accent)] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }
              `}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <span
                className={`
                  absolute left-[-12px] top-1/2 -translate-y-1/2 w-[3px] rounded bg-[var(--accent)] transition-all
                  ${activeId === heading.id ? 'h-4' : 'h-0'}
                `}
              />
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
