import type { Metadata } from 'next';
import Link from '@/components/Link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PostCard from '@/components/PostCard';
import { getAllPosts, getEssays } from '@/lib/posts';
import { getActiveProjects, getProjectPosts } from '@/lib/projects';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const statusBadge: Record<string, { label: string; mark: string; color: string }> = {
  active: { label: '진행 중', mark: '●', color: 'var(--projects)' },
  upcoming: { label: '예정', mark: '○', color: 'var(--muted)' },
  paused: { label: '일시 중지', mark: '◐', color: 'var(--muted)' },
  done: { label: '완료', mark: '✓', color: 'var(--muted)' },
};

export default function Home() {
  const allPosts = getAllPosts();
  const latestEssays = getEssays().slice(0, 3);
  const activeProjects = getActiveProjects();

  return (
    <>
      <Header posts={allPosts} />
      <main>
        <section className="pt-24 pb-20 border-b border-[var(--border)]">
          <div className="max-w-[1100px] mx-auto px-5">
            <p className="text-[12px] font-semibold text-[var(--accent)] uppercase tracking-[0.14em] mb-5">
              Ress Blog
            </p>
            <h1 className="text-[44px] md:text-[60px] leading-[1.1] font-bold tracking-tight text-[var(--text)] max-w-[820px]">
              Learning by doing,
              <br />
              <span className="text-[var(--muted)]">documenting the journey</span>
            </h1>
            <p className="mt-6 text-[16px] md:text-[17px] text-[var(--muted)] max-w-[560px] leading-relaxed">
              DevOps · Kubernetes · Istio · Observability — 학습한 내용과 부딪힌 문제를 솔직하게 기록합니다.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link
                href="/essays"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-white text-[14.5px] font-semibold hover:bg-[var(--accent-hover)] transition-colors"
              >
                Read Essays
                <span className="opacity-80">→</span>
              </Link>
              <Link
                href="/projects"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[var(--border-strong)] text-[var(--text)] text-[14.5px] font-semibold hover:bg-[var(--surface)] transition-colors"
              >
                See Projects
                <span className="text-[var(--muted)]">→</span>
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="max-w-[1100px] mx-auto px-5">
            <div className="flex items-baseline justify-between mb-8">
              <h2 className="text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                Latest Essays
              </h2>
              <Link
                href="/essays"
                className="text-[13px] text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              >
                View all →
              </Link>
            </div>
            <div className="max-w-[760px]">
              {latestEssays.map((post) => (
                <PostCard key={post.slug} post={post} track="essays" />
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 bg-[var(--surface)] border-y border-[var(--border)]">
          <div className="max-w-[1100px] mx-auto px-5">
            <div className="flex items-baseline justify-between mb-8">
              <h2 className="text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                Active Projects
              </h2>
              <Link
                href="/projects"
                className="text-[13px] text-[var(--muted)] hover:text-[var(--projects)] transition-colors"
              >
                View all →
              </Link>
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              {activeProjects.map((proj) => {
                const badge = statusBadge[proj.status];
                const posts = getProjectPosts(proj.slug);
                const seriesCount = new Set(
                  posts.map((p) => p.series?.name).filter(Boolean),
                ).size;
                return (
                  <Link
                    key={proj.slug}
                    href={`/projects/${proj.slug}`}
                    className="group block p-6 rounded-xl bg-[var(--elevated)] border border-[var(--border)] hover:border-[var(--projects)] transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <span style={{ color: badge.color }} className="text-[14px]">
                        {badge.mark}
                      </span>
                      <h3 className="text-[20px] font-bold text-[var(--text)] group-hover:text-[var(--projects)] transition-colors">
                        {proj.title}
                      </h3>
                    </div>
                    <p className="text-[14px] text-[var(--muted)] leading-relaxed mb-4">
                      {proj.tagline}
                    </p>
                    {posts.length > 0 ? (
                      <div className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
                        <span>{posts.length}편</span>
                        {seriesCount > 0 && (
                          <>
                            <span className="text-[var(--border-strong)]">·</span>
                            <span>{seriesCount} 시리즈</span>
                          </>
                        )}
                        {proj.startedAt && (
                          <>
                            <span className="text-[var(--border-strong)]">·</span>
                            <span>since {proj.startedAt}</span>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-[12px] text-[var(--muted)]">{badge.label}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="py-12">
          <div className="max-w-[1100px] mx-auto px-5 text-[13px] text-[var(--muted)]">
            <span className="text-[var(--text)] font-semibold">{allPosts.length} posts</span>
            <span className="mx-2 text-[var(--border-strong)]">·</span>
            <span>since 2025-10</span>
            <span className="mx-2 text-[var(--border-strong)]">·</span>
            <Link href="/about" className="hover:text-[var(--accent)] transition-colors">
              About →
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
