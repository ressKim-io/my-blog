import SeriesCard from './SeriesCard';
import type { SeriesWithPosts } from '@/lib/series';

// 모바일 시리즈 가로 스와이프 레일 — 순수 CSS scroll-snap (JS 없음).
// -mx-5/px-5 로 컨테이너 좌우 패딩을 상쇄해 카드가 화면 가장자리까지 스크롤된다.
export default function SeriesRailMobile({ series }: { series: SeriesWithPosts[] }) {
  return (
    <div className="-mx-5 flex gap-3 overflow-x-auto snap-x snap-mandatory px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {series.map((s) => (
        <SeriesCard key={s.id} series={s} variant="rail" />
      ))}
    </div>
  );
}
