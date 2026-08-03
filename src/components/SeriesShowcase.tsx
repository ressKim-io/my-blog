import SeriesCard from './SeriesCard';
import SeriesFeaturedCard from './SeriesFeaturedCard';
import SeriesRailMobile from './SeriesRailMobile';
import type { SeriesWithPosts } from '@/lib/series';

interface SeriesShowcaseProps {
  featured: SeriesWithPosts;
  rest: SeriesWithPosts[];
  all: SeriesWithPosts[];
}

// featured 옆 그리드에 남길 카드 수. 나머지는 더보기로 접습니다
const VISIBLE_REST = 6;

/**
 * 데스크탑: featured 큰 카드 1 + 최신 6개 그리드(3열), 나머지는 더보기로 펼침.
 * 모바일: 가로 스와이프 레일(전체) — 스크롤 자체가 더보기 역할을 합니다.
 *
 * 더보기는 details/summary라 JS가 없습니다. 클라이언트 컴포넌트로 만들면
 * SeriesWithPosts.posts(본문 포함)가 RSC 페이로드에 직렬화되므로 서버 컴포넌트로 둡니다
 */
export default function SeriesShowcase({ featured, rest, all }: SeriesShowcaseProps) {
  const visible = rest.slice(0, VISIBLE_REST);
  const hidden = rest.slice(VISIBLE_REST);

  return (
    <>
      <div className="hidden md:block">
        <div className="grid gap-5 md:grid-cols-[1.05fr_2fr]">
          <SeriesFeaturedCard series={featured} />
          <div className="grid grid-cols-3 gap-4">
            {visible.map((s) => (
              <SeriesCard key={s.id} series={s} />
            ))}
          </div>
        </div>

        {hidden.length > 0 && (
          <details className="group mt-5">
            <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--elevated)] px-5 py-2.5 text-[13px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">시리즈 {hidden.length}개 더 보기</span>
              <span className="hidden group-open:inline">접기</span>
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
              >
                <path d="M5 7.5 10 12.5 15 7.5" />
              </svg>
            </summary>
            <div className="mt-5 grid grid-cols-4 gap-4">
              {hidden.map((s) => (
                <SeriesCard key={s.id} series={s} />
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="md:hidden">
        <SeriesRailMobile series={all} />
      </div>
    </>
  );
}
