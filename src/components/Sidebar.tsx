'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Post {
  slug: string;
  title: string;
  category: string;
  series?: {
    name: string;
    order: number;
  };
}

interface SidebarProps {
  posts: Post[];
}

export default function Sidebar({ posts }: SidebarProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['kubernetes', 'challenge', 'cicd']));

  // 카테고리별로 그룹화
  const postsByCategory = posts.reduce((acc, post) => {
    const category = post.category || 'etc';
    if (!acc[category]) acc[category] = [];
    acc[category].push(post);
    return acc;
  }, {} as Record<string, Post[]>);

  const categoryLabels: Record<string, string> = {
    kubernetes: 'Kubernetes',
    challenge: 'Challenge',
    cicd: 'CI/CD',
    etc: 'Etc',
  };

  const categoryOrder = ['kubernetes', 'challenge', 'cicd', 'etc'];
  const sortedCategories = categoryOrder.filter((cat) => postsByCategory[cat]);

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const currentSlug = pathname.replace('/blog/', '');

  return (
    <>
      {/* 모바일 토글 버튼 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed left-4 bottom-4 z-50 w-12 h-12 bg-[var(--accent)] text-white rounded-full shadow-lg flex items-center justify-center"
        aria-label="Toggle sidebar"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* 오버레이 (모바일) */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* 사이드바 */}
      <aside
        className={`
          fixed top-16 left-0 h-[calc(100vh-4rem)] w-64 bg-[var(--bg-secondary)] border-r border-[var(--border)]
          overflow-y-auto z-40 transition-transform duration-300
          lg:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="p-4">
          <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-4">
            Posts ({posts.length})
          </h3>

          <nav className="space-y-2">
            {sortedCategories.map((category) => (
              <div key={category}>
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <span>{categoryLabels[category] || category}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)]">
                      {postsByCategory[category].length}
                    </span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className={`w-3 h-3 transition-transform ${expandedCategories.has(category) ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </button>

                {expandedCategories.has(category) && (
                  <ul className="ml-2 mt-1 space-y-0.5 border-l border-[var(--border)]">
                    {postsByCategory[category].map((post) => (
                      <li key={post.slug}>
                        <Link
                          href={`/blog/${post.slug}`}
                          onClick={() => setIsOpen(false)}
                          className={`
                            block pl-3 py-1.5 text-sm truncate transition-colors border-l-2 -ml-[1px]
                            ${currentSlug === post.slug
                              ? 'border-[var(--accent)] text-[var(--accent)] font-medium'
                              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]'
                            }
                          `}
                          title={post.title}
                        >
                          {post.series && (
                            <span className="text-purple-400 mr-1">#{post.series.order}</span>
                          )}
                          {post.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
}
