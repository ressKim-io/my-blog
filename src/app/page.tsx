import Link from 'next/link';
import Header from '@/components/Header';
import { getAllPosts } from '@/lib/posts';

export default function Home() {
  const allPosts = getAllPosts();

  // 카테고리별로 포스트 그룹화
  const postsByCategory = allPosts.reduce((acc, post) => {
    const category = post.category || 'etc';
    if (!acc[category]) acc[category] = [];
    acc[category].push(post);
    return acc;
  }, {} as Record<string, typeof allPosts>);

  const categoryLabels: Record<string, string> = {
    challenge: 'Challenge',
    kubernetes: 'Kubernetes',
    cicd: 'CI/CD',
    etc: 'Etc',
  };

  const categoryOrder = ['kubernetes', 'challenge', 'cicd', 'etc'];
  const sortedCategories = categoryOrder.filter((cat) => postsByCategory[cat]);

  return (
    <>
      <Header posts={allPosts} />

      <main className="pt-24 pb-16">
        <div className="max-w-4xl mx-auto px-4">
          {/* Profile Section */}
          <section className="mb-16">
            <div className="flex items-center gap-6 mb-6">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-500 flex items-center justify-center text-3xl font-bold">
                R
              </div>
              <div>
                <h1 className="text-2xl font-bold mb-1">Ress</h1>
                <p className="text-[var(--text-secondary)]">
                  Learning by doing, documenting the journey
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

          {/* Posts by Category */}
          {sortedCategories.map((category) => (
            <section key={category} className="mb-12">
              <h2 className="text-lg font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-4">
                {categoryLabels[category] || category}
                <span className="ml-2 text-sm font-normal">
                  ({postsByCategory[category].length})
                </span>
              </h2>

              <div className="grid gap-3">
                {postsByCategory[category].slice(0, 5).map((post) => (
                  <Link
                    key={post.slug}
                    href={`/blog/${post.slug}`}
                    className="group flex items-center justify-between p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all"
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
                        {post.title}
                      </h3>
                      {post.series && (
                        <span className="text-xs text-purple-400">
                          {post.series.name} #{post.series.order}
                        </span>
                      )}
                    </div>
                    <time className="text-sm text-[var(--text-muted)] ml-4 shrink-0">
                      {new Date(post.date).toLocaleDateString('ko-KR', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </time>
                  </Link>
                ))}

                {postsByCategory[category].length > 5 && (
                  <Link
                    href="/blog"
                    className="text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pl-4"
                  >
                    + {postsByCategory[category].length - 5} more posts →
                  </Link>
                )}
              </div>
            </section>
          ))}
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
