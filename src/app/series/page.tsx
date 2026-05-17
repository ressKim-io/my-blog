import type { Metadata } from 'next';
import Header from '@/components/Header';
import PageHeader from '@/components/PageHeader';
import Footer from '@/components/Footer';
import SeriesCard from '@/components/SeriesCard';
import { getAllSeries } from '@/lib/series';
import { getSearchIndex } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Series',
  description: '주제별 기술 해설 시리즈 — 동작 원리를 여러 편에 걸쳐 깊게 풀어냅니다',
  alternates: { canonical: '/series/' },
};

export default function SeriesIndexPage() {
  const allSeries = getAllSeries();
  const totalPosts = allSeries.reduce((n, s) => n + s.count, 0);

  return (
    <>
      <Header posts={getSearchIndex()} />
      <main className="pt-12 pb-16">
        <div className="max-w-[860px] mx-auto px-5">
          <PageHeader
            track="essays"
            title="Series"
            subtitle={`기술 해설 — ${allSeries.length}개 시리즈 · ${totalPosts}편`}
            description="하나의 주제를 여러 편에 걸쳐 끝까지 따라가는 기술 해설 시리즈입니다. 동작 원리를 코드와 함께 깊게 풉니다."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {allSeries.map((s) => (
              <SeriesCard key={s.id} series={s} />
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
