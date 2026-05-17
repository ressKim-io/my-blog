import { getSeriesPosts, type PostData } from './posts';

/**
 * 기술 해설(deepdive) 시리즈 메타데이터.
 *
 * - `id`   : URL 슬러그 (`/series/{id}/`)
 * - `seriesName` : frontmatter `series.name` 과 1:1 매칭되는 키
 *
 * ★ `id` 목록은 `scripts/postbuild.mjs` 의 sitemap `seriesIds` 상수와 동기화할 것.
 */
export interface SeriesMeta {
  id: string;
  seriesName: string;
  title: string;
  tagline: string;
  blurb: string;
}

// 표시 순서 = 이 배열 순서 (편 수 내림차순으로 고정)
export const seriesList: SeriesMeta[] = [
  {
    id: 'redis',
    seriesName: 'goti-deepdive-redis',
    title: 'Redis',
    tagline: '인메모리',
    blurb: '단일 스레드·자료구조·클러스터 해시 슬롯·영속화·캐시 패턴까지 Redis의 내부 동작을 풉니다',
  },
  {
    id: 'observability',
    seriesName: 'goti-deepdive-observability',
    title: '관측성',
    tagline: 'Metrics · Logs · Traces',
    blurb: 'Prometheus·OpenTelemetry·Loki·Tempo·Mimir — 메트릭·로그·트레이스 파이프라인의 동작 원리',
  },
  {
    id: 'database',
    seriesName: 'goti-deepdive-database',
    title: '데이터베이스',
    tagline: 'PostgreSQL · 복제',
    blurb: 'PostgreSQL 논리·물리 복제, pglogical, PgBouncer 풀링, 크로스 클라우드 페일오버',
  },
  {
    id: 'platform',
    seriesName: 'goti-deepdive-platform',
    title: '플랫폼',
    tagline: 'K8s · Kafka · GitOps',
    blurb: 'Kubernetes 스케일링, Kafka·Strimzi, ArgoCD GitOps, 메시징 시스템 패턴',
  },
  {
    id: 'runtime',
    seriesName: 'goti-deepdive-runtime',
    title: 'Go 런타임·부하 테스트',
    tagline: 'Runtime · Load Test',
    blurb: 'Go 동시성·런타임·GOMEMLIMIT, distroless 컨테이너, k6 부하 테스트',
  },
  {
    id: 'edge',
    seriesName: 'goti-deepdive-edge',
    title: 'Edge·CDN',
    tagline: 'Edge · CDN',
    blurb: 'Cloudflare 엣지·CDN 캐싱·Workers, circuit breaker, JWE 토큰',
  },
  {
    id: 'istio',
    seriesName: 'goti-deepdive-istio',
    title: 'Istio',
    tagline: 'Service Mesh',
    blurb: 'Istio 서비스 메시 구조, 사이드카 vs Ambient, 멀티클러스터, JWT/JWKS 검증',
  },
];

// 홈 쇼케이스 featured(큰 카드)로 고정할 시리즈 — 교체는 이 한 줄만 수정
export const FEATURED_SERIES_ID = 'redis';

export interface SeriesWithPosts extends SeriesMeta {
  posts: PostData[]; // order 1→N 정렬됨 (getSeriesPosts)
  count: number;
  latestDate: string;
}

/** 단일 시리즈 + 소속 글. 글이 0편이면 null (라우트·카드에서 자동 제외) */
export function getSeriesById(id: string): SeriesWithPosts | null {
  const meta = seriesList.find((s) => s.id === id);
  if (!meta) return null;
  // deepdive 시리즈는 essays 트랙 전용 — logs 글이 섞여도 배제(링크·격리 안전장치)
  const posts = getSeriesPosts(meta.seriesName).filter((p) => p.track === 'essays');
  if (posts.length === 0) return null;
  const latestDate = posts.reduce((max, p) => (p.date > max ? p.date : max), '');
  return { ...meta, posts, count: posts.length, latestDate };
}

/** 7개 시리즈 전체 (seriesList 순서 유지) */
export function getAllSeries(): SeriesWithPosts[] {
  return seriesList
    .map((s) => getSeriesById(s.id))
    .filter((s): s is SeriesWithPosts => s !== null);
}

/** generateStaticParams 전용 — 시리즈 id 목록 */
export function getSeriesIds(): string[] {
  return seriesList.map((s) => s.id);
}

/** 홈 쇼케이스 featured 시리즈 선정 */
export function pickFeatured(all: SeriesWithPosts[]): SeriesWithPosts {
  return all.find((s) => s.id === FEATURED_SERIES_ID) ?? all[0];
}
