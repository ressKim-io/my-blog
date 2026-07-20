import { getSeriesPosts, type PostData } from './posts';

/**
 * 기술 해설(deepdive) 시리즈 메타데이터.
 *
 * - `id`   : URL 슬러그 (`/series/{id}/`)
 * - `seriesName` : frontmatter `series.name` 과 1:1 매칭되는 키
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
  {
    id: 'packet-journey',
    seriesName: 'packet-journey',
    title: '네트워크 지연',
    tagline: 'Latency · CDN · Datacenter',
    blurb: '빛의 속도부터 데이터센터 입지까지 — 패킷이 사용자에게 닿기까지의 지연을 한 줄기로 해부합니다',
  },
  {
    id: 'kernel-runtime-tradeoffs-1',
    seriesName: 'kernel-runtime-tradeoffs-1',
    title: '시스템 콜과 스레드',
    tagline: 'System Call · Thread Model',
    blurb: '커널 모드 전환 비용부터 스레드의 원가, 런타임 무게까지 — Rust·Go·Java가 하드웨어와 만나는 첫 접점을 해부합니다',
  },
  {
    id: 'kernel-runtime-tradeoffs-2',
    seriesName: 'kernel-runtime-tradeoffs-2',
    title: 'AOT와 JIT',
    tagline: 'Compilation · Codegen',
    blurb: 'Rust의 단형화 AOT, Go의 자체 SSA 백엔드, Java의 티어드 JIT까지 — 세 언어가 기계어를 만드는 방식과 그 대가를 비교합니다',
  },
  {
    id: 'kernel-runtime-tradeoffs-3',
    seriesName: 'kernel-runtime-tradeoffs-3',
    title: '메모리 할당자',
    tagline: 'Allocator Internals',
    blurb: '커널의 지연 할당부터 ptmalloc·Go 런타임 할당자·JVM TLAB까지 — 세 할당자가 같은 계층 구조로 수렴하는 이유를 추적합니다',
  },
  {
    id: 'kernel-runtime-tradeoffs-4',
    seriesName: 'kernel-runtime-tradeoffs-4',
    title: 'GC 알고리즘',
    tagline: 'Tricolor · Mark Assist · G1 · ZGC',
    blurb: '삼색 마킹과 쓰기 배리어부터 Go의 Mark Assist, G1의 Full GC 절벽, ZGC의 colored pointer까지 — GC 비용이 어디로 옮겨 가는지 추적합니다',
  },
  {
    id: 'kernel-runtime-tradeoffs-5',
    seriesName: 'kernel-runtime-tradeoffs-5',
    title: '컨테이너 경제학',
    tagline: 'cgroup · Cloud Cost',
    blurb: '커널의 메모리 회계 규칙부터 GC 여유 공간이 만드는 노드 밀도, 힙 외부 OOMKilled, 웜업 지연까지 — 런타임 선택이 클라우드 비용으로 이어지는 경로를 추적합니다',
  },
  {
    id: 'kernel-runtime-tradeoffs-6',
    seriesName: 'kernel-runtime-tradeoffs-6',
    title: 'K8s는 Go의 한계를 어떻게 우회했나',
    tagline: 'K8s · Go Runtime Architecture',
    blurb: '컨트롤 플레인의 자기 면제부터 파드당 고루틴 물량, sync.Pool과 Informer 공유 캐시까지 — 쿠버네티스가 Go 런타임의 한계를 아키텍처로 비켜가고 사람에게 남긴 청구서를 추적합니다',
  },
  {
    id: 'k8s-cloud-optimization',
    seriesName: 'k8s-cloud-optimization',
    title: '클라우드 인프라 물리학',
    tagline: 'K8s · Cloud Managed · Physics',
    blurb: '관리형 컨트롤 플레인 은닉부터 예약 인두세, 고밀도 CNI, eBPF 리다이렉트, 가상화 이중 세금까지 — 클라우드가 K8s를 돌리기 위해 최적화한 물리적 계층과 그 대가를 해부합니다',
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

/** 시리즈 전체 (seriesList 순서 유지) */
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
