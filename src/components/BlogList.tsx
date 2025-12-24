'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface Post {
  slug: string;
  title: string;
  excerpt?: string;
  category: string;
  tags?: string[];
  series?: {
    name: string;
    order: number;
  };
  date: string;
}

interface SeriesGroup {
  name: string;
  posts: Post[];
  category: string;
}

interface BlogListProps {
  posts: Post[];
}

export default function BlogList({ posts }: BlogListProps) {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get('category');

  const [activeCategory, setActiveCategory] = useState<string>(categoryParam || 'all');
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  // URL 파라미터 변경 시 카테고리 업데이트
  useEffect(() => {
    if (categoryParam) {
      setActiveCategory(categoryParam);
    }
  }, [categoryParam]);

  // 카테고리 목록
  const categories = useMemo(() => {
    const cats = new Set(posts.map((p) => p.category));
    return ['all', ...Array.from(cats)];
  }, [posts]);

  const categoryLabels: Record<string, { label: string; icon: string }> = {
    all: { label: '전체', icon: '📋' },
    kubernetes: { label: 'Kubernetes', icon: '☸️' },
    challenge: { label: 'Challenge', icon: '🏆' },
    cicd: { label: 'CI/CD', icon: '🔄' },
    etc: { label: 'Etc', icon: '📝' },
  };

  // 필터링된 포스트
  const filteredPosts = useMemo(() => {
    if (activeCategory === 'all') return posts;
    return posts.filter((p) => p.category === activeCategory);
  }, [posts, activeCategory]);

  // 시리즈 그룹화
  const { seriesGroups, standalonePosts } = useMemo(() => {
    const seriesMap = new Map<string, SeriesGroup>();
    const standalone: Post[] = [];

    filteredPosts.forEach((post) => {
      if (post.series) {
        const existing = seriesMap.get(post.series.name);
        if (existing) {
          existing.posts.push(post);
        } else {
          seriesMap.set(post.series.name, {
            name: post.series.name,
            posts: [post],
            category: post.category,
          });
        }
      } else {
        standalone.push(post);
      }
    });

    // 시리즈 내 정렬
    seriesMap.forEach((series) => {
      series.posts.sort((a, b) => (a.series?.order || 0) - (b.series?.order || 0));
    });

    return {
      seriesGroups: Array.from(seriesMap.values()),
      standalonePosts: standalone,
    };
  }, [filteredPosts]);

  const toggleSeries = (name: string) => {
    const newExpanded = new Set(expandedSeries);
    if (newExpanded.has(name)) {
      newExpanded.delete(name);
    } else {
      newExpanded.add(name);
    }
    setExpandedSeries(newExpanded);
  };

  return (
    <div>
      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        {categories.map((cat) => {
          const info = categoryLabels[cat] || { label: cat, icon: '📁' };
          const count = cat === 'all' ? posts.length : posts.filter((p) => p.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${activeCategory === cat
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }
              `}
            >
              <span>{info.icon}</span>
              <span>{info.label}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeCategory === cat ? 'bg-white/20' : 'bg-[var(--bg-tertiary)]'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Series Groups */}
      {seriesGroups.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-4">
            📚 시리즈
          </h2>
          <div className="space-y-3">
            {seriesGroups.map((series) => {
              const isExpanded = expandedSeries.has(series.name);
              return (
                <div
                  key={series.name}
                  className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] overflow-hidden"
                >
                  {/* Series Header */}
                  <button
                    onClick={() => toggleSeries(series.name)}
                    className="w-full flex items-center justify-between p-4 hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-purple-400 text-lg">📚</span>
                      <div className="text-left">
                        <h3 className="font-medium text-[var(--text-primary)]">
                          {series.name}
                        </h3>
                        <p className="text-xs text-[var(--text-muted)]">
                          {categoryLabels[series.category]?.label || series.category}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 rounded-full bg-purple-500/20 text-purple-400">
                        {series.posts.length}편
                      </span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Series Posts */}
                  {isExpanded && (
                    <div className="border-t border-[var(--border)]">
                      {series.posts.map((post, idx) => (
                        <Link
                          key={post.slug}
                          href={`/blog/${post.slug}`}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-tertiary)] transition-colors border-b border-[var(--border)] last:border-b-0"
                        >
                          <span className="w-6 h-6 flex items-center justify-center rounded-full bg-purple-500/20 text-purple-400 text-xs font-medium">
                            {post.series?.order}
                          </span>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm text-[var(--text-primary)] truncate">
                              {post.title}
                            </h4>
                          </div>
                          <time className="text-xs text-[var(--text-muted)]">
                            {new Date(post.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                          </time>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Standalone Posts */}
      {standalonePosts.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-4">
            📝 개별 글
          </h2>
          <div className="space-y-3">
            {standalonePosts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)]">
                        {categoryLabels[post.category]?.label || post.category}
                      </span>
                      {post.tags?.slice(0, 2).map((tag) => (
                        <span key={tag} className="text-xs text-[var(--text-muted)]">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <h3 className="font-medium text-[var(--text-primary)] mb-1">
                      {post.title}
                    </h3>
                    {post.excerpt && (
                      <p className="text-sm text-[var(--text-muted)] line-clamp-2">
                        {post.excerpt}
                      </p>
                    )}
                  </div>
                  <time className="text-sm text-[var(--text-muted)] shrink-0">
                    {new Date(post.date).toLocaleDateString('ko-KR', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {filteredPosts.length === 0 && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          해당 카테고리에 글이 없습니다.
        </div>
      )}
    </div>
  );
}
