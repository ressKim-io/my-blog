import SeriesCard from './SeriesCard';
import SeriesFeaturedCard from './SeriesFeaturedCard';
import SeriesRailMobile from './SeriesRailMobile';
import type { SeriesWithPosts } from '@/lib/series';

interface SeriesShowcaseProps {
  featured: SeriesWithPosts;
  rest: SeriesWithPosts[];
  all: SeriesWithPosts[];
}

// 데스크탑: featured 큰 카드 1 + 나머지 6개 그리드.  모바일: 가로 스와이프 레일(7개).
export default function SeriesShowcase({ featured, rest, all }: SeriesShowcaseProps) {
  return (
    <>
      <div className="hidden gap-5 md:grid md:grid-cols-[1.05fr_2fr]">
        <SeriesFeaturedCard series={featured} />
        <div className="grid grid-cols-3 gap-4">
          {rest.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      </div>
      <div className="md:hidden">
        <SeriesRailMobile series={all} />
      </div>
    </>
  );
}
