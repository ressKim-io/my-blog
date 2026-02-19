import Link from 'next/link';
import Header from '@/components/Header';
import { getAllPosts } from '@/lib/posts';

export default function Home() {
  const allPosts = getAllPosts();

  // Category grouping
  const postsByCategory = allPosts.reduce((acc, post) => {
    const category = post.category || 'etc';
    if (!acc[category]) acc[category] = [];
    acc[category].push(post);
    return acc;
  }, {} as Record<string, typeof allPosts>);

  const categoryLabels: Record<string, string> = {
    istio: 'Istio',
    kubernetes: 'Kubernetes',
    challenge: 'Challenge',
    argocd: 'ArgoCD',
    monitoring: 'Monitoring',
    cicd: 'CI/CD',
  };

  const categoryOrder = ['istio', 'kubernetes', 'challenge', 'argocd', 'monitoring', 'cicd'];
  const sortedCategories = categoryOrder.filter((cat) => postsByCategory[cat]);

  // Tag counts (top 10)
  const tagCounts = new Map<string, number>();
  allPosts.forEach((p) => p.tags?.forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
  const topTags = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Featured (latest) + Recent (next 4)
  const featuredPost = allPosts[0];
  const recentPosts = allPosts.slice(1, 5);

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <>
      <Header posts={allPosts} />

      <main className="pt-24 pb-16">
        <div className="max-w-5xl mx-auto px-4">
          {/* Hero */}
          <section className="mb-16">
            <h1 className="text-3xl font-bold tracking-tight mb-3">ress 의 기술블로그</h1>
            <p className="text-[var(--text-secondary)] text-lg max-w-xl leading-relaxed">
              DevOps, Kubernetes, Service Mesh.
              <br />
              Learning by doing, documenting the journey.
            </p>
            <div className="flex gap-3 mt-6">
              <Link
                href="/blog"
                className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--text-primary)] text-[var(--bg-primary)] hover:opacity-90 transition-opacity"
              >
                All Posts
              </Link>
              <a
                href="https://github.com/resskim-io"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-sm font-medium rounded-lg text-[var(--text-secondary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                GitHub
              </a>
            </div>

            {/* About + Stats */}
            <h2 className="mt-10 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">About</h2>
            <div className="flex flex-col md:flex-row gap-5">
              {/* About Card */}
              <div className="flex-1 min-w-0 p-6 bg-[var(--bg-secondary)] rounded-xl surface-card flex flex-col justify-center">
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-3">
                  DevOps와 Platform Engineering에 관심이 많은 엔지니어입니다.
                  <span className="text-[var(--text-primary)] font-medium"> Kubernetes </span>
                  위에서 서비스를 운영하고,
                  <span className="text-[var(--text-primary)] font-medium"> Istio </span>
                  로 Service Mesh를 구성하며,
                  <span className="text-[var(--text-primary)] font-medium"> Terraform </span>
                  으로 인프라를 코드로 관리하는 것에 대해 공부하고 있습니다.
                </p>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
                  개발자 경험(DX)을 개선하는 것에도 깊은 관심을 갖고 있습니다.
                  CI/CD 파이프라인 최적화, GitOps 워크플로우 설계,
                  Observability 구축까지 — 팀이 더 빠르고 안정적으로 배포할 수 있도록 고민하는 것을 좋아합니다.
                </p>
                <div className="flex flex-wrap gap-2">
                  {['Kubernetes', 'Istio', 'Terraform', 'ArgoCD', 'Prometheus', 'AWS', 'Docker', 'CI/CD'].map((tech) => (
                    <span
                      key={tech}
                      className="px-2.5 py-1 rounded-md text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
              </div>

              {/* Stats Card */}
              <div className="md:w-52 shrink-0 p-6 bg-[var(--bg-secondary)] rounded-xl surface-card flex flex-row md:flex-col justify-around md:justify-center gap-4 md:gap-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-[var(--text-primary)]">{allPosts.length}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Posts</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-[var(--text-primary)]">{sortedCategories.length}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Categories</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-[var(--text-primary)]">{tagCounts.size}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Tags</p>
                </div>
              </div>
            </div>
          </section>

          {/* Featured Post — large card */}
          {featuredPost && (
            <section className="mb-12">
              <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">Latest</h2>
              <Link
                href={`/blog/${featuredPost.slug}`}
                className="group block p-8 bg-[var(--bg-secondary)] rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors surface-card"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs text-[var(--text-muted)]">{featuredPost.category}</span>
                  <span className="text-xs text-[var(--text-muted)]">{formatDate(featuredPost.date)}</span>
                </div>
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-3 group-hover:text-[var(--accent)] transition-colors leading-snug">
                  {featuredPost.title}
                </h3>
                {featuredPost.excerpt && (
                  <p className="text-[var(--text-secondary)] leading-relaxed max-w-2xl">
                    {featuredPost.excerpt}
                  </p>
                )}
                <span className="inline-block mt-5 text-sm text-[var(--accent)] group-hover:text-[var(--accent-hover)] transition-colors">
                  Read more →
                </span>
              </Link>
            </section>
          )}

          {/* Recent Posts — 2 col */}
          <section className="mb-16">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Recent</h2>
              <Link href="/blog" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {recentPosts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group p-6 bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors surface-card"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs text-[var(--text-muted)]">{post.category}</span>
                    <span className="text-xs text-[var(--text-muted)]">{formatDate(post.date)}</span>
                  </div>
                  <h3 className="font-medium text-[var(--text-primary)] mb-3 group-hover:text-[var(--accent)] transition-colors leading-snug">
                    {post.title}
                  </h3>
                  {post.excerpt && (
                    <p className="text-sm text-[var(--text-muted)] line-clamp-3 leading-relaxed">
                      {post.excerpt}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </section>

          {/* Categories — larger cards with description */}
          <section className="mb-16">
            <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">Categories</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {sortedCategories.map((category) => {
                const posts = postsByCategory[category];
                const count = posts.length;
                const latest = posts[0];
                return (
                  <Link
                    key={category}
                    href={`/blog?category=${category}`}
                    className="group p-5 bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors surface-card"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                        {categoryLabels[category] || category}
                      </h3>
                      <span className="text-xs text-[var(--text-muted)]">{count}</span>
                    </div>
                    {latest && (
                      <p className="text-xs text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                        {latest.title}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Popular Tags */}
          <section className="mb-16">
            <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-4">Popular Tags</h2>
            <div className="flex flex-wrap gap-2">
              {topTags.map(([tag, count]) => (
                <Link
                  key={tag}
                  href={`/blog?tag=${tag}`}
                  className="px-3 py-1.5 rounded-lg text-sm bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {tag} <span className="text-[var(--text-muted)]">{count}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-[var(--border)]">
        <div className="max-w-5xl mx-auto px-4 text-center text-[var(--text-muted)] text-xs">
          <p>© 2025 Ress</p>
        </div>
      </footer>
    </>
  );
}
