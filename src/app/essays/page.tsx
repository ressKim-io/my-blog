import type { Metadata } from 'next';
import { Suspense } from 'react';
import Header from '@/components/Header';
import PageHeader from '@/components/PageHeader';
import Footer from '@/components/Footer';
import PostListClient from '@/components/PostListClient';
import { getEssays, getAllPosts } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Essays',
  description: '다듬은 글 — 개념, ADR, 회고',
  alternates: { canonical: '/essays/' },
};

const categoryLabelMap: Record<string, string> = {
  istio: 'Istio',
  kubernetes: 'Kubernetes',
  challenge: 'Challenge',
  argocd: 'ArgoCD',
  monitoring: 'Monitoring',
  cicd: 'CI/CD',
};

export default function EssaysPage() {
  const allEssays = getEssays();

  const counts = new Map<string, number>();
  allEssays.forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1));
  const categories = Object.entries(categoryLabelMap)
    .filter(([name]) => counts.has(name))
    .map(([name, label]) => ({ name, label, count: counts.get(name) ?? 0 }));

  return (
    <>
      <Header posts={getAllPosts()} />
      <main className="pt-12 pb-16">
        <div className="max-w-[860px] mx-auto px-5">
          <PageHeader
            track="essays"
            title="Essays"
            subtitle={`다듬은 글 — ${allEssays.length}편`}
            description="개념·ADR·회고처럼 한 번 발행한 뒤 거의 고치지 않는 글입니다. 지금 시점의 결정과 이해를 기록합니다."
          />
          <Suspense fallback={<div className="py-10 text-center text-[var(--muted)] text-sm">불러오는 중…</div>}>
            <PostListClient posts={allEssays} track="essays" categories={categories} variant="card" />
          </Suspense>
        </div>
      </main>
      <Footer />
    </>
  );
}
