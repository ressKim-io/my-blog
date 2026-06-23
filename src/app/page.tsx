import type { Metadata } from 'next';
import Link from '@/components/Link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import SeriesShowcase from '@/components/SeriesShowcase';
import HomeCategoryFeed from '@/components/HomeCategoryFeed';
import { getEssays, getSearchIndex } from '@/lib/posts';
import { getAllSeries, pickFeatured } from '@/lib/series';
import { getActiveProjects, getProjectPosts } from '@/lib/projects';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

const categoryLabelMap: Record<string, string> = {
  istio: 'Istio',
  kubernetes: 'Kubernetes',
  challenge: 'Challenge',
  argocd: 'ArgoCD',
  monitoring: 'Monitoring',
  cicd: 'CI/CD',
  network: 'Network',
  rust: 'Rust',
};

const statusBadge: Record<string, { label: string; mark: string; color: string }> = {
  active: { label: '진행 중', mark: '●', color: 'var(--projects)' },
  upcoming: { label: '예정', mark: '○', color: 'var(--muted)' },
  paused: { label: '일시 중지', mark: '◐', color: 'var(--muted)' },
  done: { label: '완료', mark: '✓', color: 'var(--muted)' },
};

export default function Home() {
  const allSeries = getAllSeries();
  const featured = pickFeatured(allSeries);
  const rest = allSeries.filter((s) => s.id !== featured.id);
  const seriesTotal = allSeries.reduce((n, s) => n + s.count, 0);

  const essays = getEssays();
  const feedPosts = essays.map((p) => ({
    slug: p.slug,
    title: p.title,
    category: p.category,
    date: p.date,
  }));
  const counts = new Map<string, number>();
  essays.forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1));
  const categories = Object.entries(categoryLabelMap)
    .filter(([name]) => counts.has(name))
    .map(([name, label]) => ({ name, label, count: counts.get(name) ?? 0 }));

  const activeProjects = getActiveProjects();

  return (
    <>
      <Header posts={getSearchIndex()} />
      <main>
        {/* Identity */}
        <section className="pt-20 pb-14 border-b border-[var(--border)]">
          <div className="max-w-[1100px] mx-auto px-5">
            <p className="text-[12px] font-semibold text-[var(--accent)] uppercase tracking-[0.14em] mb-5">
              Ress Blog
            </p>
            <h1 className="text-[40px] md:text-[56px] leading-[1.1] font-bold tracking-tight text-[var(--text)] max-w-[820px]">
              Learning by doing,
              <br />
              <span className="text-[var(--muted)]">documenting the journey</span>
            </h1>
            <p className="mt-6 text-[16px] md:text-[17px] text-[var(--muted)] max-w-[560px] leading-relaxed">
              DevOps · Kubernetes · Istio · Observability — 학습한 내용과 부딪힌 문제를 솔직하게 기록합니다.
            </p>
          </div>
        </section>

        {/* Series showcase */}
        <section className="py-16">
          <div className="max-w-[1100px] mx-auto px-5">
            <div className="flex items-end justify-between gap-4 mb-8">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--muted-soft)] mb-2">
                  기술 해설 — {allSeries.length}개 시리즈 · {seriesTotal}편
                </div>
                <h2 className="text-[24px] font-bold tracking-tight text-[var(--text)]">
                  시리즈로 깊게 읽기
                </h2>
              </div>
              <Link
                href="/series/"
                className="shrink-0 text-[13px] text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
              >
                전체 시리즈 →
              </Link>
            </div>
            <SeriesShowcase featured={featured} rest={rest} all={allSeries} />
          </div>
        </section>

        {/* Category feed */}
        <section className="py-16 border-t border-[var(--border)]">
          <div className="max-w-[1100px] mx-auto px-5">
            <div className="mb-8">
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--muted-soft)] mb-2">
                essays · {essays.length}편
              </div>
              <h2 className="text-[24px] font-bold tracking-tight text-[var(--text)]">
                카테고리로 둘러보기
              </h2>
            </div>
            <HomeCategoryFeed posts={feedPosts} categories={categories} />
          </div>
        </section>

        {/* Projects */}
        <section className="py-16 bg-[var(--surface)] border-t border-[var(--border)]">
          <div className="max-w-[1100px] mx-auto px-5">
            <div className="flex items-end justify-between gap-4 mb-8">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--muted-soft)] mb-2">
                  projects
                </div>
                <h2 className="text-[24px] font-bold tracking-tight text-[var(--text)]">
                  진행 중인 작업
                </h2>
              </div>
              <Link
                href="/projects/"
                className="shrink-0 text-[13px] text-[var(--muted)] hover:text-[var(--projects)] transition-colors"
              >
                모든 프로젝트 →
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
                    href={`/projects/${proj.slug}/`}
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
      </main>
      <Footer />
    </>
  );
}
