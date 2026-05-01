import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from '@/components/Link';
import Header from '@/components/Header';
import PageHeader from '@/components/PageHeader';
import Footer from '@/components/Footer';
import ProjectPostsView from '@/components/ProjectPostsView';
import { projects, getProject, getProjectSeries } from '@/lib/projects';
import { getAllPosts } from '@/lib/posts';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return projects.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return {};
  return {
    title: project.title,
    description: project.description,
    alternates: { canonical: `/projects/${slug}/` },
  };
}

const phaseStatusColor: Record<string, string> = {
  done: 'var(--muted)',
  active: 'var(--projects)',
  upcoming: 'var(--border-strong)',
};

const phaseStatusMark: Record<string, string> = {
  done: '✓',
  active: '●',
  upcoming: '○',
};

export default async function ProjectDetailPage({ params }: Props) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const allPosts = getAllPosts();
  const { series, standalone } = getProjectSeries(slug);

  return (
    <>
      <Header posts={allPosts} />
      <main className="pt-12 pb-16">
        <div className="max-w-[900px] mx-auto px-5">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--projects)] hover:opacity-70 transition-opacity mb-8"
          >
            <span>←</span>
            <span className="font-medium">Projects</span>
          </Link>

          <PageHeader
            track="projects"
            title={project.title}
            subtitle={project.tagline}
            description={project.description}
          />

          <div className="flex flex-wrap gap-1.5 mb-12">
            {project.topTags.map((tag) => (
              <span
                key={tag}
                className="text-[12px] px-2.5 py-1 rounded bg-[var(--surface)] text-[var(--muted)]"
              >
                {tag}
              </span>
            ))}
          </div>

          {project.phases && project.phases.length > 0 && (
            <section className="mb-14">
              <h2 className="text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-5">
                Phase
              </h2>
              <ol className="space-y-3">
                {project.phases.map((phase) => {
                  const color = phaseStatusColor[phase.status];
                  const mark = phaseStatusMark[phase.status];
                  return (
                    <li
                      key={phase.name}
                      className="flex items-start gap-4 p-4 rounded-lg border border-[var(--border)]"
                    >
                      <span className="text-[16px] mt-0.5" style={{ color }}>
                        {mark}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-3 mb-1">
                          <h3
                            className="text-[16px] font-semibold"
                            style={{ color: phase.status === 'active' ? 'var(--projects)' : 'var(--text)' }}
                          >
                            {phase.name}
                          </h3>
                          <span className="text-[13px] text-[var(--muted)] tabular-nums shrink-0">
                            {phase.period}
                          </span>
                        </div>
                        <p className="text-[14.5px] text-[var(--muted)] leading-relaxed">
                          {phase.description}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {series.length === 0 && standalone.length === 0 ? (
            <p className="py-16 text-center text-[var(--muted)]">아직 글이 없습니다.</p>
          ) : (
            <Suspense fallback={null}>
              <ProjectPostsView series={series} standalone={standalone} />
            </Suspense>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
