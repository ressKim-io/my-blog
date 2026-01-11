'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

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

export default function BlogList({ posts }: BlogListProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tagParam = searchParams.get('tag');

  // 상태
  const [viewMode, setViewMode] = useState<'all' | 'series'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(tagParam);
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [showMoreTags, setShowMoreTags] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // URL 파라미터 변경 시 태그 업데이트
  useEffect(() => {
    setSelectedTag(tagParam);
  }, [tagParam]);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowMoreTags(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 태그별 글 수 계산 (상위 5개 탭 + 나머지 드롭다운)
  const { topTags, moreTags } = useMemo(() => {
    const tagCount = new Map<string, number>();
    posts.forEach((p) => {
      p.tags?.forEach((tag) => {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      });
    });
    const sorted = Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1]);

    return {
      topTags: sorted.slice(0, 5),
      moreTags: sorted.slice(5),
    };
  }, [posts]);

  // 시리즈 정보 맵 (시리즈명 → 전체 글 수)
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

  // 필터링된 포스트 (태그 기반)
  const filteredPosts = useMemo(() => {
    let result = posts;
    if (selectedTag) {
      result = result.filter((p) => p.tags?.includes(selectedTag));
    }
    return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [posts, selectedTag]);

  // 시리즈 그룹화 (시리즈별 보기용)
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

  const handleTagClick = (tag: string | null, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setSelectedTag(tag);
    setShowMoreTags(false);
    if (tag) {
      router.push(`/blog?tag=${tag}`);
    } else {
      router.push('/blog');
    }
  };

  const clearTagFilter = () => {
    setSelectedTag(null);
    router.push('/blog');
  };

  return (
    <div>
      {/* View Mode Toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setViewMode('all')}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${viewMode === 'all'
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }
          `}
        >
          <span>📋</span>
          <span>전체 글</span>
        </button>
        <button
          onClick={() => setViewMode('series')}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${viewMode === 'series'
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }
          `}
        >
          <span>📚</span>
          <span>시리즈별</span>
        </button>
      </div>

      {/* Tag Tabs + Dropdown */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* 전체 탭 */}
        <button
          onClick={() => handleTagClick(null)}
          className={`
            px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${selectedTag === null
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }
          `}
        >
          전체 ({posts.length})
        </button>

        {/* 상위 5개 태그 탭 */}
        {topTags.map(([tag, count]) => (
          <button
            key={tag}
            onClick={() => handleTagClick(tag)}
            className={`
              px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${selectedTag === tag
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
              }
            `}
          >
            #{tag} ({count})
          </button>
        ))}

        {/* 더보기 드롭다운 */}
        {moreTags.length > 0 && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowMoreTags(!showMoreTags)}
              className={`
                flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-all
                ${showMoreTags
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }
              `}
            >
              <span>더보기</span>
              <span className="text-xs">({moreTags.length})</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`w-4 h-4 transition-transform ${showMoreTags ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showMoreTags && (
              <div className="absolute top-full left-0 mt-2 z-20 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg max-h-64 overflow-y-auto min-w-48">
                {moreTags.map(([tag, count]) => (
                  <button
                    key={tag}
                    onClick={() => handleTagClick(tag)}
                    className={`
                      w-full text-left px-4 py-2 text-sm transition-colors
                      ${selectedTag === tag
                        ? 'bg-[var(--accent)] text-white'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                      }
                    `}
                  >
                    #{tag} ({count})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selected Tag Filter */}
      {selectedTag && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-sm text-[var(--text-muted)]">태그 필터:</span>
          <span className="px-3 py-1 bg-[var(--accent)] text-white rounded-full text-sm flex items-center gap-2">
            #{selectedTag}
            <button
              onClick={clearTagFilter}
              className="hover:opacity-70 ml-1"
              aria-label="태그 필터 해제"
            >
              ×
            </button>
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            ({filteredPosts.length}개 글)
          </span>
        </div>
      )}

      {/* Content based on View Mode */}
      {viewMode === 'all' ? (
        /* All Posts View - 모든 글 개별 표시 */
        <section>
          <div className="space-y-3">
            {filteredPosts.map((post) => {
              const seriesInfo = post.series ? seriesInfoMap.get(post.series.name) : null;
              return (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="block p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* 시리즈 정보 */}
                      {post.series && seriesInfo && (
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400 flex items-center gap-1">
                            <span>📚</span>
                            <span>{post.series.name}</span>
                            <span className="opacity-70">{post.series.order}/{seriesInfo.total}</span>
                          </span>
                        </div>
                      )}
                      {/* 태그 */}
                      <div className="flex items-center gap-2 mb-2">
                        {post.tags?.slice(0, 3).map((tag) => (
                          <button
                            key={tag}
                            onClick={(e) => handleTagClick(tag, e)}
                            className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                          >
                            #{tag}
                          </button>
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
              );
            })}
          </div>
        </section>
      ) : (
        /* Series View - 시리즈별 그룹화 */
        <>
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
                          {series.posts.map((post) => (
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
                          {post.tags?.slice(0, 2).map((tag) => (
                            <button
                              key={tag}
                              onClick={(e) => handleTagClick(tag, e)}
                              className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                            >
                              #{tag}
                            </button>
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
        </>
      )}

      {/* Empty State */}
      {filteredPosts.length === 0 && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          해당 태그에 글이 없습니다.
        </div>
      )}
    </div>
  );
}
