import type { Metadata } from 'next';
import { Suspense } from 'react';
import Header from '@/components/Header';
import PageHeader from '@/components/PageHeader';
import Footer from '@/components/Footer';
import PostListClient from '@/components/PostListClient';
import { getLogs, getAllPosts } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Logs',
  description: '현장 기록 — 작업 중 부딪힌 문제와 해결 과정',
  alternates: { canonical: '/logs/' },
};

const categoryLabelMap: Record<string, string> = {
  istio: 'Istio',
  kubernetes: 'Kubernetes',
  challenge: 'Challenge',
  argocd: 'ArgoCD',
  monitoring: 'Monitoring',
  cicd: 'CI/CD',
};

export default function LogsPage() {
  const allLogs = getLogs();

  const counts = new Map<string, number>();
  allLogs.forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1));
  const categories = Object.entries(categoryLabelMap)
    .filter(([name]) => counts.has(name))
    .map(([name, label]) => ({ name, label, count: counts.get(name) ?? 0 }));

  return (
    <>
      <Header posts={getAllPosts()} />
      <main className="pt-12 pb-16">
        <div className="max-w-[860px] mx-auto px-5">
          <PageHeader
            track="logs"
            title="Logs"
            subtitle={`현장 기록 — ${allLogs.length}편`}
            description="작업 중 부딪힌 문제와 해결 과정의 기록입니다. 매뉴얼이 아니라 그때그때 남긴 메모입니다."
          />
          <Suspense fallback={<div className="py-10 text-center text-[var(--muted)] text-sm">불러오는 중…</div>}>
            <PostListClient posts={allLogs} track="logs" categories={categories} variant="line" perPage={30} />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}
