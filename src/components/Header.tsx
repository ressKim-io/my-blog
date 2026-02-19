'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Search from './Search';
import ThemeToggle from './ThemeToggle';

interface Post {
  slug: string;
  title: string;
  excerpt?: string;
  category: string;
  tags?: string[];
  date: string;
}

interface HeaderProps {
  posts?: Post[];
}

const categories = [
  { name: 'istio', label: 'Istio' },
  { name: 'kubernetes', label: 'Kubernetes' },
  { name: 'challenge', label: 'Challenge' },
  { name: 'argocd', label: 'ArgoCD' },
  { name: 'monitoring', label: 'Monitoring' },
  { name: 'cicd', label: 'CI/CD' },
];

export default function Header({ posts = [] }: HeaderProps) {
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close mobile menu on route change
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
  }

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg-primary)]/80 backdrop-blur-md border-b border-[var(--border)]">
        <div className="max-w-[1100px] mx-auto px-4 h-14 flex items-center justify-between">
          {/* Left: Logo */}
          <Link href="/" className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
            ress 의 기술블로그
          </Link>

          {/* Center: Nav (desktop) */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/blog"
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                pathname === '/blog'
                  ? 'text-[var(--text-primary)] bg-[var(--bg-tertiary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Posts
            </Link>

            {/* Category Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  dropdownOpen
                    ? 'text-[var(--text-primary)] bg-[var(--bg-tertiary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Categories
                <svg xmlns="http://www.w3.org/2000/svg" className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {dropdownOpen && (
                <div className="absolute top-full left-0 mt-1 py-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-lg min-w-[160px]">
                  {categories.map((cat) => (
                    <Link
                      key={cat.name}
                      href={`/blog?category=${cat.name}`}
                      onClick={() => setDropdownOpen(false)}
                      className="block px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      {cat.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>

          {/* Right: Search + Theme + Mobile Menu */}
          <div className="flex items-center gap-2">
            <Search posts={posts} />
            <ThemeToggle />
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              aria-label="Menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setMobileOpen(false)} />
          <div className="fixed top-0 right-0 bottom-0 w-72 bg-[var(--bg-primary)] border-l border-[var(--border)] z-50 overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <span className="text-sm font-medium text-[var(--text-primary)]">Menu</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="p-4 space-y-1">
              <Link href="/" className="block px-3 py-2.5 text-sm rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]">
                Home
              </Link>
              <Link href="/blog" className="block px-3 py-2.5 text-sm rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]">
                All Posts
              </Link>
              <div className="pt-3 pb-1 px-3">
                <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Categories</span>
              </div>
              {categories.map((cat) => (
                <Link
                  key={cat.name}
                  href={`/blog?category=${cat.name}`}
                  className="block px-3 py-2.5 text-sm rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {cat.label}
                </Link>
              ))}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
