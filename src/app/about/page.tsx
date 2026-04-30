import type { Metadata } from 'next';
import Header from '@/components/Header';
import PageHeader from '@/components/PageHeader';
import Footer from '@/components/Footer';
import { getAllPosts, getEssays, getLogs } from '@/lib/posts';
import { projects } from '@/lib/projects';

export const metadata: Metadata = {
  title: 'About',
  description: 'Ress · DevOps Engineer',
  alternates: { canonical: '/about/' },
};

const techStack = ['Kubernetes', 'Istio', 'Terraform', 'ArgoCD', 'Prometheus', 'AWS', 'Docker', 'CI/CD'];

export default function AboutPage() {
  const allPosts = getAllPosts();
  const essays = getEssays();
  const logs = getLogs();

  const tagSet = new Set<string>();
  allPosts.forEach((p) => p.tags?.forEach((t) => tagSet.add(t)));

  return (
    <>
      <Header posts={allPosts} />
      <main className="pt-12 pb-16">
        <div className="max-w-[760px] mx-auto px-5">
          <PageHeader
            title="About"
            subtitle="Ress · DevOps Engineer"
          />

          <div className="prose">
            <p>
              DevOps와 Platform Engineering에 관심이 많은 엔지니어입니다.
              <strong> Kubernetes </strong>위에서 서비스를 운영하고,
              <strong> Istio </strong>로 Service Mesh를 구성하며,
              <strong> Terraform </strong>으로 인프라를 코드로 관리하는 것에 대해 공부하고 있습니다.
            </p>
            <p>
              개발자 경험(DX)을 개선하는 것에도 깊은 관심을 갖고 있습니다.
              CI/CD 파이프라인 최적화, GitOps 워크플로우 설계, Observability 구축까지 — 팀이 더 빠르고
              안정적으로 배포할 수 있도록 고민하는 일을 좋아합니다.
            </p>
            <p>
              이 블로그는 학습 과정과 트러블슈팅을 솔직하게 기록하는 공간입니다. 다듬은 글은
              <a href="/essays/"> Essays</a>에, 작업 중 부딪힌 문제는
              <a href="/logs/"> Logs</a>에, 장기 프로젝트의 의사결정은
              <a href="/projects/"> Projects</a>에서 볼 수 있습니다.
            </p>
          </div>

          <section className="mt-12">
            <h2 className="text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">
              Tech Stack
            </h2>
            <div className="flex flex-wrap gap-2">
              {techStack.map((t) => (
                <span
                  key={t}
                  className="px-3 py-1 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[13px] text-[var(--text-secondary)]"
                >
                  {t}
                </span>
              ))}
            </div>
          </section>

          <section className="mt-12">
            <h2 className="text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">
              Stats
            </h2>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Essays', value: essays.length, color: 'var(--essays)' },
                { label: 'Logs', value: logs.length, color: 'var(--logs)' },
                { label: 'Projects', value: projects.length, color: 'var(--projects)' },
                { label: 'Tags', value: tagSet.size, color: 'var(--accent)' },
              ].map((s) => (
                <div
                  key={s.label}
                  className="p-5 rounded-lg border border-[var(--border)] bg-[var(--elevated)]"
                >
                  <dd
                    className="text-[28px] font-bold leading-none"
                    style={{ color: s.color }}
                  >
                    {s.value}
                  </dd>
                  <dt className="mt-2 text-[12px] text-[var(--muted)] uppercase tracking-wider">
                    {s.label}
                  </dt>
                </div>
              ))}
            </dl>
          </section>

          <section className="mt-12">
            <h2 className="text-[12px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-4">
              Contact
            </h2>
            <ul className="space-y-2 text-[14.5px]">
              <li>
                <a
                  href="https://github.com/resskim-io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] hover:opacity-70 transition-opacity"
                >
                  GitHub →
                </a>
              </li>
              <li>
                <a
                  href="/feed.xml"
                  className="text-[var(--accent)] hover:opacity-70 transition-opacity"
                >
                  RSS →
                </a>
              </li>
            </ul>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
