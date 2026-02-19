'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import CategoryNav from './CategoryNav';
import Pagination from './Pagination';

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

interface SeriesInfo {
  name: string;
  total: number;
}

interface BlogListProps {
  posts: Post[];
}

const POSTS_PER_PAGE = 12;

const categoryLabels: Record<string, string> = {
  istio: 'Istio',
  kubernetes: 'Kubernetes',
  challenge: 'Challenge',
  argocd: 'ArgoCD',
  monitoring: 'Monitoring',
  cicd: 'CI/CD',
};

export default function BlogList({ posts }: BlogListProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tagParam = searchParams.get('tag');
  const categoryParam = searchParams.get('category');

  const [viewMode, setViewMode] = useState<'all' | 'series'>('all');
  const selectedTag = tagParam;
  const selectedCategory = categoryParam;
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [showMoreTags, setShowMoreTags] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [prevTag, setPrevTag] = useState(tagParam);
  const [prevCategory, setPrevCategory] = useState(categoryParam);

  if (prevTag !== tagParam || prevCategory !== categoryParam) {
    setPrevTag(tagParam);
    setPrevCategory(categoryParam);
    setCurrentPage(1);
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowMoreTags(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Category list with counts
  const categoryList = useMemo(() => {
    const counts = new Map<string, number>();
    posts.forEach((p) => {
      counts.set(p.category, (counts.get(p.category) || 0) + 1);
    });
    return Object.entries(categoryLabels)
      .filter(([name]) => counts.has(name))
      .map(([name, label]) => ({ name, label, count: counts.get(name) || 0 }));
  }, [posts]);

  // Tag counts
  const { topTags, moreTags } = useMemo(() => {
    const tagCount = new Map<string, number>();
    posts.forEach((p) => {
      p.tags?.forEach((tag) => {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      });
    });
    const sorted = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]);
    return { topTags: sorted.slice(0, 5), moreTags: sorted.slice(5) };
  }, [posts]);

  const seriesInfoMap = useMemo(() => {
    const map = new Map<string, SeriesInfo>();
    posts.forEach((post) => {
      if (post.series) {
        const existing = map.get(post.series.name);
        if (existing) {
          existing.total += 1;
        } else {
          map.set(post.series.name, { name: post.series.name, total: 1 });
        }
      }
    });
    return map;
  }, [posts]);

  // Filtered posts
  const filteredPosts = useMemo(() => {
    let result = posts;
    if (selectedCategory) {
      result = result.filter((p) => p.category === selectedCategory);
    }
    if (selectedTag) {
      result = result.filter((p) => p.tags?.includes(selectedTag));
    }
    return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [posts, selectedCategory, selectedTag]);

  // Pagination
  const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE);
  const paginatedPosts = useMemo(() => {
    const start = (currentPage - 1) * POSTS_PER_PAGE;
    return filteredPosts.slice(start, start + POSTS_PER_PAGE);
  }, [filteredPosts, currentPage]);

  // Series groups
  const { seriesGroups, standalonePosts } = useMemo(() => {
    const seriesMap = new Map<string, SeriesGroup>();
    const standalone: Post[] = [];

    filteredPosts.forEach((post) => {
      if (post.series) {
        const existing = seriesMap.get(post.series.name);
        if (existing) {
          existing.posts.push(post);
        } else {
          seriesMap.set(post.series.name, { name: post.series.name, posts: [post], category: post.category });
        }
      } else {
        standalone.push(post);
      }
    });

    seriesMap.forEach((series) => {
      series.posts.sort((a, b) => (a.series?.order || 0) - (b.series?.order || 0));
    });

    return { seriesGroups: Array.from(seriesMap.values()), standalonePosts: standalone };
  }, [filteredPosts]);

  const toggleSeries = (name: string) => {
    const next = new Set(expandedSeries);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpandedSeries(next);
  };

  const handleCategorySelect = (category: string | null) => {
    if (category) {
      router.push(`/blog?category=${category}`);
    } else {
      router.push('/blog');
    }
  };

  const handleTagClick = (tag: string | null, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setShowMoreTags(false);
    const params = new URLSearchParams();
    if (selectedCategory) params.set('category', selectedCategory);
    if (tag) params.set('tag', tag);
    router.push(`/blog${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div>
      {/* Category Tabs */}
      <CategoryNav
        categories={categoryList}
        selected={selectedCategory}
        onSelect={handleCategorySelect}
        totalCount={posts.length}
      />

      {/* View Mode + Tag Filters */}
      <div className="flex flex-wrap items-center gap-2 mt-6 mb-6">
        <div className="flex gap-1 mr-4">
          <button
            onClick={() => setViewMode('all')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              viewMode === 'all'
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setViewMode('series')}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              viewMode === 'series'
                ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            Series
          </button>
        </div>

        {/* Tag Pills */}
        {topTags.map(([tag, count]) => (
          <button
            key={tag}
            onClick={() => handleTagClick(selectedTag === tag ? null : tag)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              selectedTag === tag
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            #{tag} ({count})
          </button>
        ))}

        {moreTags.length > 0 && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowMoreTags(!showMoreTags)}
              className="px-3 py-1 rounded-full text-xs bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              +{moreTags.length} more
            </button>
            {showMoreTags && (
              <div className="absolute top-full left-0 mt-2 z-20 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-lg max-h-64 overflow-y-auto min-w-44 py-1">
                {moreTags.map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() => handleTagClick(tag)}
                    className={`w-full text-left px-4 py-2 text-xs transition-colors ${
                      selectedTag === tag
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    #{tag} ({count})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active Tag Filter Indicator */}
      {selectedTag && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs text-[var(--text-muted)]">Filtered:</span>
          <span className="px-2.5 py-0.5 bg-[var(--accent)] text-white rounded-full text-xs flex items-center gap-1.5">
            #{selectedTag}
            <button onClick={() => handleTagClick(null)} className="hover:opacity-70" aria-label="Clear filter">
              x
            </button>
          </span>
          <span className="text-xs text-[var(--text-muted)]">({filteredPosts.length})</span>
        </div>
      )}

      {/* Content */}
      {viewMode === 'all' ? (
        <>
          <div className="divide-y divide-[var(--border)]">
            {paginatedPosts.map((post) => {
              const seriesInfo = post.series ? seriesInfoMap.get(post.series.name) : null;
              return (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group block py-6 -mx-4 px-4 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)]">{post.category}</span>
                      {seriesInfo && (
                        <span className="text-xs text-[var(--text-muted)]">
                          · {post.series?.name} {post.series?.order}/{seriesInfo.total}
                        </span>
                      )}
                    </div>
                    <time className="text-xs text-[var(--text-muted)]">
                      {formatDate(post.date)}
                    </time>
                  </div>
                  <h3 className="text-base font-medium text-[var(--text-primary)] mb-2 group-hover:text-[var(--accent)] transition-colors leading-snug">
                    {post.title}
                  </h3>
                  {post.excerpt && (
                    <p className="text-sm text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                      {post.excerpt}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
        </>
      ) : (
        <>
          {seriesGroups.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">
                Series
              </h2>
              <div className="space-y-2">
                {seriesGroups.map((series) => {
                  const isExpanded = expandedSeries.has(series.name);
                  return (
                    <div key={series.name} className="bg-[var(--bg-secondary)] rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleSeries(series.name)}
                        className="w-full flex items-center justify-between p-4 hover:bg-[var(--bg-tertiary)] transition-colors"
                      >
                        <div className="text-left">
                          <h3 className="font-medium text-[var(--text-primary)] text-sm">{series.name}</h3>
                          <span className="text-xs text-[var(--text-muted)]">{series.category}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--text-muted)]">{series.posts.length} posts</span>
                          <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-[var(--border)]">
                          {series.posts.map((post) => (
                            <Link
                              key={post.slug}
                              href={`/blog/${post.slug}`}
                              className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-tertiary)] transition-colors border-b border-[var(--border)] last:border-b-0"
                            >
                              <span className="w-6 h-6 flex items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-xs font-medium">
                                {post.series?.order}
                              </span>
                              <span className="flex-1 text-sm text-[var(--text-primary)] truncate">{post.title}</span>
                              <time className="text-xs text-[var(--text-muted)]">{formatDate(post.date)}</time>
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

          {standalonePosts.length > 0 && (
            <section>
              <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">
                Standalone
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {standalonePosts.map((post) => (
                  <Link
                    key={post.slug}
                    href={`/blog/${post.slug}`}
                    className="group p-6 bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <span className="text-xs text-[var(--text-muted)] mb-3 block">{post.category}</span>
                    <h3 className="font-medium text-[var(--text-primary)] mb-3 group-hover:text-[var(--accent)] transition-colors leading-snug">
                      {post.title}
                    </h3>
                    {post.excerpt && (
                      <p className="text-sm text-[var(--text-muted)] line-clamp-3 mb-4 leading-relaxed">{post.excerpt}</p>
                    )}
                    <time className="text-xs text-[var(--text-muted)]">{formatDate(post.date)}</time>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {filteredPosts.length === 0 && (
        <div className="text-center py-16 text-[var(--text-muted)] text-sm">
          No posts found.
        </div>
      )}
    </div>
  );
}
