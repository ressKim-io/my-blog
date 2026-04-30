import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import PageHeader from '@/components/PageHeader';
import Footer from '@/components/Footer';
import { projects, getProjectPosts } from '@/lib/projects';
import { getAllPosts } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Projects',
  description: '장기 프로젝트의 의사결정과 트러블슈팅 기록',
  alternates: { canonical: '/projects/' },
};

const statusBadge: Record<string, { label: string; mark: string }> = {
  active: { label: '진행 중', mark: '●' },
  upcoming: { label: '예정', mark: '○' },
  paused: { label: '일시 중지', mark: '◐' },
  done: { label: '완료', mark: '✓' },
};

export default function ProjectsPage() {
  const allPosts = getAllPosts();

  return (
    <>
      <Header posts={allPosts} />
      <main className="pt-12 pb-16">
        <div className="max-w-[860px] mx-auto px-5">
          <PageHeader
            track="projects"
            title="Projects"
            subtitle={`${projects.length}개 프로젝트`}
            description="여러 편에 걸쳐 이어지는 장기 프로젝트입니다. 일반 글과 달리 시간 흐름과 의사결정의 맥락이 핵심입니다."
          />

          <div className="space-y-5">
            {projects.map((proj) => {
              const posts = getProjectPosts(proj.slug);
              const seriesCount = new Set(
                posts.map((p) => p.series?.name).filter(Boolean),
              ).size;
              const badge = statusBadge[proj.status];
              const activePhase = proj.phases?.find((ph) => ph.status === 'active');

              return (
                <Link
                  key={proj.slug}
                  href={`/projects/${proj.slug}`}
                  className="group block p-7 rounded-xl border border-[var(--border)] bg-[var(--elevated)] hover:border-[var(--projects)] transition-colors"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <span
                      className="text-[15px] mt-1"
                      style={{ color: proj.status === 'active' ? 'var(--projects)' : 'var(--muted)' }}
                    >
                      {badge.mark}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[22px] font-bold text-[var(--text)] group-hover:text-[var(--projects)] transition-colors leading-tight">
                        {proj.title}
                      </h3>
                      <p className="mt-1 text-[14px] text-[var(--muted)]">{proj.tagline}</p>
                    </div>
                    <span
                      className="text-[12px] px-2.5 py-1 rounded-full bg-[var(--surface)] text-[var(--muted)] shrink-0"
                    >
                      {badge.label}
                    </span>
                  </div>

                  <p className="text-[14.5px] leading-relaxed text-[var(--muted)] mb-4">
                    {proj.description}
                  </p>

                  {posts.length > 0 && (
                    <div className="flex items-center gap-3 text-[12.5px] text-[var(--muted)] mb-4">
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
                      {activePhase && (
                        <>
                          <span className="text-[var(--border-strong)]">·</span>
                          <span style={{ color: 'var(--projects)' }}>{activePhase.name}</span>
                        </>
                      )}
                    </div>
                  )}

                  {proj.topTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {proj.topTags.slice(0, 6).map((tag) => (
                        <span
                          key={tag}
                          className="text-[11.5px] px-2 py-0.5 rounded bg-[var(--surface)] text-[var(--muted)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
