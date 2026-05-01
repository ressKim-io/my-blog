'use client';

import { useState } from 'react';
import Link from './Link';
import { usePathname } from 'next/navigation';
import Search from './Search';

interface Post {
  slug: string;
  title: string;
  excerpt?: string;
  category: string;
  tags?: string[];
  date: string;
  track?: 'essays' | 'logs';
}

interface HeaderProps {
  posts?: Post[];
}

const navItems = [
  { href: '/essays', label: 'Essays', match: '/essays', color: 'var(--essays)' },
  { href: '/projects', label: 'Projects', match: '/projects', color: 'var(--projects)' },
  { href: '/about', label: 'About', match: '/about', color: 'var(--text)' },
];

export default function Header({ posts = [] }: HeaderProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // logs 트랙은 검색에 노출하지 않습니다 (전면 격리 정책)
  const searchablePosts = posts.filter((p) => p.track !== 'logs');

  const isActive = (match: string) =>
    match === '/about' ? pathname === '/about' : pathname?.startsWith(match);

  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setMobileOpen(false);
  }

  return (
    <>
      <header className="sticky top-0 z-40 bg-[var(--bg)]/85 backdrop-blur-md border-b border-[var(--border)]">
        <div className="max-w-[1100px] mx-auto px-5 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="text-base font-bold tracking-tight text-[var(--text)] hover:opacity-70 transition-opacity"
          >
            Ress
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const active = isActive(item.match);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="relative px-3.5 py-1.5 text-[14px] font-medium transition-colors"
                  style={{
                    color: active ? item.color : 'var(--muted)',
                  }}
                >
                  {item.label}
                  {active && (
                    <span
                      className="absolute left-3.5 right-3.5 -bottom-[15px] h-[2px]"
                      style={{ background: item.color }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5">
            <Search posts={searchablePosts} />
            <a
              href="/feed.xml"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex w-9 h-9 items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
              aria-label="RSS"
              title="RSS"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 11a9 9 0 019 9M4 4a16 16 0 0116 16M5 19a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
            </a>
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)] transition-colors"
              aria-label="Menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setMobileOpen(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-72 bg-[var(--bg)] border-l border-[var(--border)] z-50 overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
              <span className="text-sm font-semibold text-[var(--text)]">Menu</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="p-3">
              <Link
                href="/"
                className="block px-4 py-3 text-[15px] rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]"
              >
                Home
              </Link>
              {navItems.map((item) => {
                const active = isActive(item.match);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block px-4 py-3 text-[15px] font-medium rounded-lg hover:bg-[var(--surface)]"
                    style={{ color: active ? item.color : 'var(--muted)' }}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <a
                href="/feed.xml"
                target="_blank"
                rel="noopener noreferrer"
                className="block px-4 py-3 text-[15px] rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]"
              >
                RSS
              </a>
            </nav>
          </div>
        </>
      )}
    </>
  );
}
