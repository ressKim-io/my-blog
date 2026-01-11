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

interface SeriesGroup {
  name: string;
  posts: Post[];
  latestSlug: string;
}

export default function Sidebar({ posts }: SidebarProps) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  // localStorage에서 초기값 읽기 (lazy initializer)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar-collapsed') === 'true';
  });
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['istio', 'kubernetes', 'challenge', 'argocd', 'monitoring', 'cicd']));

  // 접힘 상태 저장
  const toggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('sidebar-collapsed', String(newState));
  };

  const currentSlug = pathname.replace('/blog/', '').replace(/\/$/, '');

  // 시리즈와 개별 포스트 분리
  const seriesMap = new Map<string, SeriesGroup>();
  const standalonePosts: Post[] = [];

  posts.forEach((post) => {
    if (post.series) {
      const existing = seriesMap.get(post.series.name);
      if (existing) {
        existing.posts.push(post);
        // order가 1인 글을 대표로
        if (post.series.order === 1) {
          existing.latestSlug = post.slug;
        }
      } else {
        seriesMap.set(post.series.name, {
          name: post.series.name,
          posts: [post],
          latestSlug: post.slug,
        });
      }
    } else {
      standalonePosts.push(post);
    }
  });

  // 시리즈 내 포스트 정렬
  seriesMap.forEach((series) => {
    series.posts.sort((a, b) => (a.series?.order || 0) - (b.series?.order || 0));
    series.latestSlug = series.posts[0]?.slug || series.latestSlug;
  });

  // 카테고리별 그룹화 (시리즈는 하나로, 개별 글은 그대로)
  const categoryItems: Record<string, Array<{ type: 'series'; data: SeriesGroup } | { type: 'post'; data: Post }>> = {};

  seriesMap.forEach((series) => {
    const category = series.posts[0]?.category || 'etc';
    if (!categoryItems[category]) categoryItems[category] = [];
    categoryItems[category].push({ type: 'series', data: series });
  });

  standalonePosts.forEach((post) => {
    const category = post.category || 'etc';
    if (!categoryItems[category]) categoryItems[category] = [];
    categoryItems[category].push({ type: 'post', data: post });
  });

  const categoryLabels: Record<string, string> = {
    istio: 'Istio',
    kubernetes: 'Kubernetes',
    challenge: 'Challenge',
    argocd: 'ArgoCD',
    monitoring: 'Monitoring',
    cicd: 'CI/CD',
    etc: 'Etc',
  };

  const categoryOrder = ['istio', 'kubernetes', 'challenge', 'argocd', 'monitoring', 'cicd', 'etc'];
  const sortedCategories = categoryOrder.filter((cat) => categoryItems[cat]);

  const toggleCategory = (category: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  const toggleSeries = (seriesName: string) => {
    const newExpanded = new Set(expandedSeries);
    if (newExpanded.has(seriesName)) {
      newExpanded.delete(seriesName);
    } else {
      newExpanded.add(seriesName);
    }
    setExpandedSeries(newExpanded);
  };

  const isPostActive = (slug: string) => currentSlug === slug;
  const isSeriesActive = (series: SeriesGroup) => series.posts.some((p) => isPostActive(p.slug));

  // 최대 표시 개수
  const MAX_ITEMS_PER_CATEGORY = 5;

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

      {/* 데스크톱 접기/펼치기 버튼 */}
      <button
        onClick={toggleCollapse}
        className={`
          hidden lg:flex fixed top-20 z-50 h-8 items-center justify-center
          bg-[var(--bg-secondary)] border border-[var(--border)] rounded-r-md
          text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]
          transition-all duration-300 shadow-sm
          ${isCollapsed ? 'left-0 w-8' : 'left-64 w-6'}
        `}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={isCollapsed ? '사이드바 펼치기' : '사이드바 접기'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* 사이드바 */}
      <aside
        className={`
          fixed top-16 left-0 h-[calc(100vh-4rem)] w-64 bg-[var(--bg-secondary)] border-r border-[var(--border)]
          overflow-y-auto z-40 transition-transform duration-300
          ${isCollapsed ? 'lg:-translate-x-full' : 'lg:translate-x-0'}
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">
              Posts
            </h3>
            <Link
              href="/blog"
              className="text-xs text-[var(--accent)] hover:underline"
              onClick={() => setIsOpen(false)}
            >
              View All
            </Link>
          </div>

          <nav className="space-y-1">
            {sortedCategories.map((category) => {
              const items = categoryItems[category];
              const displayItems = items.slice(0, MAX_ITEMS_PER_CATEGORY);
              const hasMore = items.length > MAX_ITEMS_PER_CATEGORY;

              return (
                <div key={category} className="mb-3">
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded hover:bg-[var(--bg-tertiary)]"
                  >
                    <span>{categoryLabels[category] || category}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)]">
                        {items.length}
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
                    <ul className="mt-1 space-y-0.5">
                      {displayItems.map((item) => {
                        if (item.type === 'series') {
                          const series = item.data;
                          const isActive = isSeriesActive(series);
                          const isExpanded = expandedSeries.has(series.name);

                          return (
                            <li key={series.name}>
                              {/* 시리즈 헤더 */}
                              <button
                                onClick={() => toggleSeries(series.name)}
                                className={`
                                  w-full flex items-center justify-between px-3 py-1.5 text-sm rounded transition-colors
                                  ${isActive
                                    ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                                  }
                                `}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className="text-purple-400">📚</span>
                                  <span className="truncate">{series.name}</span>
                                </span>
                                <span className="flex items-center gap-1 shrink-0">
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                                    {series.posts.length}
                                  </span>
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </span>
                              </button>

                              {/* 시리즈 내 포스트 목록 */}
                              {isExpanded && (
                                <ul className="ml-4 mt-1 space-y-0.5 border-l border-[var(--border)]">
                                  {series.posts.map((post) => (
                                    <li key={post.slug}>
                                      <Link
                                        href={`/blog/${post.slug}`}
                                        onClick={() => setIsOpen(false)}
                                        className={`
                                          block pl-3 py-1 text-sm truncate transition-colors border-l-2 -ml-[1px]
                                          ${isPostActive(post.slug)
                                            ? 'border-[var(--accent)] text-[var(--accent)] font-medium'
                                            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)]'
                                          }
                                        `}
                                        title={post.title}
                                      >
                                        <span className="text-purple-400 mr-1">#{post.series?.order}</span>
                                        {post.title.replace(/\[.*?\]\s*/, '').slice(0, 25)}...
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          );
                        } else {
                          const post = item.data;
                          return (
                            <li key={post.slug}>
                              <Link
                                href={`/blog/${post.slug}`}
                                onClick={() => setIsOpen(false)}
                                className={`
                                  block px-3 py-1.5 text-sm truncate transition-colors rounded
                                  ${isPostActive(post.slug)
                                    ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
                                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                                  }
                                `}
                                title={post.title}
                              >
                                {post.title}
                              </Link>
                            </li>
                          );
                        }
                      })}

                      {hasMore && (
                        <li>
                          <Link
                            href="/blog"
                            onClick={() => setIsOpen(false)}
                            className="block px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                          >
                            + {items.length - MAX_ITEMS_PER_CATEGORY} more →
                          </Link>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </aside>
    </>
  );
}
