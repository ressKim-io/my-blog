'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Fuse from 'fuse.js';

interface SearchItem {
  slug: string;
  title: string;
  excerpt?: string;
  category: string;
  tags?: string[];
  date: string;
}

interface SearchProps {
  posts: SearchItem[];
}

export default function Search({ posts }: SearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Fuse.js 설정 (memoized)
  const fuse = useMemo(() => new Fuse(posts, {
    keys: [
      { name: 'title', weight: 0.4 },
      { name: 'excerpt', weight: 0.3 },
      { name: 'tags', weight: 0.2 },
      { name: 'category', weight: 0.1 },
    ],
    threshold: 0.3,
    includeScore: true,
  }), [posts]);

  // 검색 결과 (memoized - useEffect 대신 useMemo로 동기 계산)
  const results = useMemo(() => {
    if (query.trim()) {
      return fuse.search(query).map(r => r.item).slice(0, 8);
    }
    return [];
  }, [query, fuse]);

  // query 변경 시 selectedIndex 리셋 (query 변경에 대한 동기화 필수)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 키보드 단축키 (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }

      if (e.key === 'Escape') {
        setIsOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 모달 열릴 때 포커스
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // 결과 네비게이션
  const handleKeyNavigation = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      router.push(`/blog/${results[selectedIndex].slug}`);
      setIsOpen(false);
      setQuery('');
    }
  }, [results, selectedIndex, router]);

  const handleSelect = (slug: string) => {
    router.push(`/blog/${slug}`);
    setIsOpen(false);
    setQuery('');
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg hover:border-[var(--accent)]/50 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="hidden sm:inline">검색</span>
        <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-[var(--bg-tertiary)] rounded">⌘K</kbd>
      </button>
    );
  }

  return (
    <>
      {/* 오버레이 */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={() => {
          setIsOpen(false);
          setQuery('');
        }}
      />

      {/* 모달 */}
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-xl z-50 px-4">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
          {/* 검색 입력 */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyNavigation}
              placeholder="포스트 검색..."
              className="flex-1 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
            />
            <kbd className="px-2 py-1 text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded">ESC</kbd>
          </div>

          {/* 검색 결과 */}
          <div className="max-h-[60vh] overflow-y-auto">
            {query && results.length === 0 && (
              <div className="px-4 py-8 text-center text-[var(--text-muted)]">
                검색 결과가 없습니다
              </div>
            )}

            {results.map((result, index) => (
              <button
                key={result.slug}
                onClick={() => handleSelect(result.slug)}
                className={`
                  w-full px-4 py-3 text-left flex items-start gap-3 transition-colors
                  ${index === selectedIndex ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-tertiary)]'}
                `}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-1.5 py-0.5 bg-[var(--accent)]/20 text-[var(--accent)] rounded">
                      {result.category}
                    </span>
                    <span className="text-[var(--text-primary)] font-medium truncate">
                      {result.title}
                    </span>
                  </div>
                  {result.excerpt && (
                    <p className="text-sm text-[var(--text-muted)] truncate">
                      {result.excerpt}
                    </p>
                  )}
                </div>
                {index === selectedIndex && (
                  <span className="text-xs text-[var(--text-muted)]">↵</span>
                )}
              </button>
            ))}

            {!query && (
              <div className="px-4 py-6 text-center text-[var(--text-muted)] text-sm">
                <p>제목, 내용, 태그로 검색하세요</p>
                <div className="flex justify-center gap-4 mt-3 text-xs">
                  <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded">↑↓</kbd> 이동</span>
                  <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded">↵</kbd> 선택</span>
                  <span><kbd className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded">ESC</kbd> 닫기</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
