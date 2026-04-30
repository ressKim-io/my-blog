import { getAllPosts, type PostData } from './posts';

export type ProjectStatus = 'active' | 'upcoming' | 'paused' | 'done';

export interface Phase {
  name: string;
  description: string;
  period: string;
  status: 'done' | 'active' | 'upcoming';
}

export interface ProjectMeta {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  status: ProjectStatus;
  startedAt?: string;
  topTags: string[];
  phases?: Phase[];
  postFilter: (post: PostData) => boolean;
}

export const projects: ProjectMeta[] = [
  {
    slug: 'go-ti',
    title: 'go-ti',
    tagline: '대규모 티켓팅 시스템',
    description:
      '이 시스템의 DevOps 영역을 맡으며 부딪힌 트러블슈팅과 의사결정 기록입니다.',
    status: 'active',
    startedAt: '2025-12',
    topTags: ['Kubernetes', 'Istio', 'Kafka', 'PgBouncer', 'Multicloud', 'Observability'],
    phases: [
      {
        name: 'Phase 1 — Foundation',
        description: 'Spring Boot 모놀리스 + EKS 기본 구성',
        period: '2025-12 ~ 2026-01',
        status: 'done',
      },
      {
        name: 'Phase 2 — Scaling',
        description: '큐 도입, 부하 테스트, 동시성 처리',
        period: '2026-02',
        status: 'done',
      },
      {
        name: 'Phase 3 — Multicloud',
        description: 'AWS·GCP 다중 클러스터, DB 분리',
        period: '2026-03',
        status: 'done',
      },
      {
        name: 'Phase 4 — Observability',
        description: 'Loki/Tempo/Mimir + OTel 파이프라인',
        period: '2026-04 ~',
        status: 'active',
      },
    ],
    postFilter: (post) => post.slug.startsWith('goti-') || post.series?.name?.startsWith('goti-') === true,
  },
  {
    slug: 'ai-improvement',
    title: 'AI 개선',
    tagline: '글쓰기 워크플로우 최적화',
    description:
      'Claude Code · Skill · Agent를 활용한 블로그 글쓰기·리뷰·다이어그램 워크플로우 개선 기록입니다.',
    status: 'upcoming',
    startedAt: '2026-05',
    topTags: ['Claude Code', 'Skill', 'Agent'],
    postFilter: (post) =>
      post.tags?.includes('ai-improvement') === true ||
      post.tags?.includes('claude-code') === true ||
      post.slug.startsWith('ai-'),
  },
];

export function getProject(slug: string): ProjectMeta | undefined {
  return projects.find((p) => p.slug === slug);
}

export function getProjectPosts(slug: string): PostData[] {
  const project = getProject(slug);
  if (!project) return [];
  return getAllPosts().filter(project.postFilter);
}

export interface SeriesGroup {
  name: string;
  posts: PostData[];
}

export function getProjectSeries(slug: string): { series: SeriesGroup[]; standalone: PostData[] } {
  const posts = getProjectPosts(slug);
  const seriesMap = new Map<string, PostData[]>();
  const standalone: PostData[] = [];

  posts.forEach((post) => {
    if (post.series?.name) {
      const arr = seriesMap.get(post.series.name) ?? [];
      arr.push(post);
      seriesMap.set(post.series.name, arr);
    } else {
      standalone.push(post);
    }
  });

  const series: SeriesGroup[] = Array.from(seriesMap.entries())
    .map(([name, posts]) => ({
      name,
      posts: posts.sort((a, b) => (a.series?.order || 0) - (b.series?.order || 0)),
    }))
    .sort((a, b) => b.posts.length - a.posts.length);

  return { series, standalone };
}

export function getActiveProjects(): ProjectMeta[] {
  return projects.filter((p) => p.status === 'active' || p.status === 'upcoming');
}
