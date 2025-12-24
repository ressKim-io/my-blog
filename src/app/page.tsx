import Link from 'next/link';
import Header from '@/components/Header';
import { getAllPosts } from '@/lib/posts';

interface SeriesInfo {
  name: string;
  count: number;
  latestSlug: string;
  category: string;
}

export default function Home() {
  const allPosts = getAllPosts();

  // 시리즈 그룹화
  const seriesMap = new Map<string, SeriesInfo>();
  const standalonePosts = allPosts.filter((post) => {
    if (post.series) {
      const existing = seriesMap.get(post.series.name);
      if (existing) {
        existing.count++;
        if (post.series.order === 1) {
          existing.latestSlug = post.slug;
        }
      } else {
        seriesMap.set(post.series.name, {
          name: post.series.name,
          count: 1,
          latestSlug: post.slug,
          category: post.category,
        });
      }
      return false;
    }
    return true;
  });

  const seriesList = Array.from(seriesMap.values());

  // 카테고리별 그룹화
  const postsByCategory = allPosts.reduce((acc, post) => {
    const category = post.category || 'etc';
    if (!acc[category]) acc[category] = [];
    acc[category].push(post);
    return acc;
  }, {} as Record<string, typeof allPosts>);

  const categoryLabels: Record<string, { label: string; icon: string; desc: string }> = {
    kubernetes: { label: 'Kubernetes', icon: '☸️', desc: 'K8s, Istio, 클러스터 운영' },
    challenge: { label: 'Challenge', icon: '🏆', desc: '실전 프로젝트 챌린지' },
    cicd: { label: 'CI/CD', icon: '🔄', desc: '배포 자동화, 파이프라인' },
    etc: { label: 'Etc', icon: '📝', desc: '기타 기술 글' },
  };

  const categoryOrder = ['kubernetes', 'challenge', 'cicd', 'etc'];
  const sortedCategories = categoryOrder.filter((cat) => postsByCategory[cat]);

  return (
    <>
      <Header posts={allPosts} />

      <main className="pt-24 pb-16">
        <div className="max-w-5xl mx-auto px-4">
          {/* Profile Section */}
          <section className="mb-16">
            <div className="flex items-center gap-6 mb-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-500 flex items-center justify-center text-3xl font-bold text-white">
                R
              </div>
              <div>
                <h1 className="text-2xl font-bold mb-1">Ress</h1>
                <p className="text-[var(--text-secondary)]">
                  더 나은 방향을 고민하는 개발자
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <a
                href="https://github.com/resskim-io"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors"
              >
                GitHub
              </a>
              <Link
                href="/blog"
                className="px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:border-[var(--text-muted)] transition-colors"
              >
                All Posts
              </Link>
            </div>
          </section>

          {/* Series Section */}
          {seriesList.length > 0 && (
            <section className="mb-12">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <span>📚</span> 시리즈
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {seriesList.map((series) => (
                  <Link
                    key={series.name}
                    href={`/blog/${series.latestSlug}`}
                    className="group p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                        {series.name}
                      </h3>
                      <span className="text-xs px-2 py-1 rounded-full bg-purple-500/20 text-purple-400">
                        {series.count}편
                      </span>
                    </div>
                    <p className="text-sm text-[var(--text-muted)]">
                      {categoryLabels[series.category]?.label || series.category}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Categories Section */}
          <section className="mb-12">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <span>📂</span> 카테고리
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {sortedCategories.map((category) => {
                const info = categoryLabels[category];
                const count = postsByCategory[category].length;
                return (
                  <Link
                    key={category}
                    href="/blog"
                    className="group p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all"
                  >
                    <div className="text-2xl mb-2">{info?.icon}</div>
                    <h3 className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                      {info?.label || category}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{info?.desc}</p>
                    <p className="text-sm text-[var(--text-secondary)] mt-2">{count}개의 글</p>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Recent Posts */}
          <section className="mb-12">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <span>🕐</span> 최근 글
              </h2>
              <Link
                href="/blog"
                className="text-sm text-[var(--accent)] hover:underline"
              >
                전체 보기 →
              </Link>
            </div>
            <div className="space-y-3">
              {standalonePosts.slice(0, 5).map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group flex items-center justify-between p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)]">
                        {post.category}
                      </span>
                    </div>
                    <h3 className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
                      {post.title}
                    </h3>
                  </div>
                  <time className="text-sm text-[var(--text-muted)] ml-4 shrink-0">
                    {new Date(post.date).toLocaleDateString('ko-KR', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </time>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-[var(--border)]">
        <div className="max-w-4xl mx-auto px-4 text-center text-[var(--text-muted)] text-sm">
          <p>© 2025 Ress Blog</p>
        </div>
      </footer>
    </>
  );
}
