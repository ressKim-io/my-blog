import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const postsDirectory = path.join(process.cwd(), 'src/content');

export type PostType = 'troubleshooting' | 'adr' | 'concept' | 'retrospective';
export type Track = 'essays' | 'logs';

export interface PostData {
  slug: string;
  title: string;
  excerpt?: string;
  category: string;
  tags?: string[];
  series?: {
    name: string;
    order: number;
  };
  date: string;
  content: string;
  type?: PostType;
  track: Track;
}

const TYPE_TAGS: PostType[] = ['troubleshooting', 'adr', 'concept', 'retrospective'];

// 글의 본질을 표시 메타로 라벨링한다 (PostCard·PostDetail의 typeLabels에서 사용).
// 트랙 격리는 디렉토리 위치(SSOT)가 결정하므로 슬러그 패턴 추론은 두지 않는다.
// frontmatter에 type 또는 메타 태그(troubleshooting/adr/concept/retrospective)가
// 명시되어 있을 때만 라벨이 붙고, 그 외는 라벨 없이 카테고리·제목만 노출한다.
function inferType(
  data: matter.GrayMatterFile<string>['data'],
): PostType | undefined {
  if (typeof data.type === 'string' && (TYPE_TAGS as string[]).includes(data.type)) {
    return data.type as PostType;
  }
  if (Array.isArray(data.tags)) {
    const lowerTags = data.tags.map((tag: unknown) => String(tag).toLowerCase());
    for (const t of TYPE_TAGS) {
      if (lowerTags.includes(t)) return t;
    }
  }
  return undefined;
}

// 디렉토리 위치(essays/{cat}/ vs logs/{cat}/)가 track·category의 1순위 SSOT.
// inferType은 글의 본질 표시 메타로만 사용 — track 결정에는 더 이상 영향 없음.

function readPost(relativePath: string): PostData {
  const slug = path.basename(relativePath, '.md');
  const fullPath = path.join(postsDirectory, relativePath);
  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const parsed = matter(fileContents);
  const { data, content } = parsed;

  const segments = relativePath.split(path.sep);
  const trackFromDir: Track = segments[0] === 'logs' ? 'logs' : 'essays';
  const categoryFromDir = segments.length >= 3 ? segments[1] : undefined;

  const type = inferType(data);

  return {
    slug,
    title: data.title,
    excerpt: data.excerpt,
    category: data.category ?? categoryFromDir,
    tags: data.tags,
    series: data.series,
    date: data.date,
    content,
    type,
    track: trackFromDir,
  };
}

let cachedPosts: PostData[] | null = null;
let slugIndex: Map<string, string> | null = null;

function listMarkdownFiles(): string[] {
  return fs
    .readdirSync(postsDirectory, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.relative(postsDirectory, path.join(e.parentPath, e.name)));
}

export function getAllPosts(): PostData[] {
  if (cachedPosts) return cachedPosts;
  if (!fs.existsSync(postsDirectory)) return [];

  const relativePaths = listMarkdownFiles();
  slugIndex = new Map(
    relativePaths.map((rel) => [path.basename(rel, '.md'), rel]),
  );
  const posts = relativePaths
    .map(readPost)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  cachedPosts = posts;
  return posts;
}

export function getPostBySlug(slug: string): PostData | null {
  if (!slugIndex) getAllPosts();
  const relativePath = slugIndex?.get(slug);
  if (!relativePath) return null;
  return readPost(relativePath);
}

export function getSeriesPosts(seriesName: string): PostData[] {
  return getAllPosts()
    .filter((post) => post.series?.name === seriesName)
    .sort((a, b) => (a.series?.order || 0) - (b.series?.order || 0));
}

export function getEssays(): PostData[] {
  return getAllPosts().filter((p) => p.track === 'essays');
}

export function getLogs(): PostData[] {
  return getAllPosts().filter((p) => p.track === 'logs');
}

export function getPostsByTrack(track: Track): PostData[] {
  return getAllPosts().filter((p) => p.track === track);
}

/**
 * 헤더 검색(Search)용 경량 글 메타.
 * 본문(content)을 제외해, 클라이언트 컴포넌트(Header→Search)로 직렬화되는
 * RSC 페이로드를 줄인다. Fuse.js 검색에 필요한 필드만 포함한다.
 * logs 트랙은 격리 정책상 검색 대상이 아니므로 essays만 포함한다.
 */
export interface SearchPost {
  slug: string;
  title: string;
  excerpt?: string;
  category: string;
  tags?: string[];
  date: string;
  track: Track;
}

export function getSearchIndex(): SearchPost[] {
  return getEssays().map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    category: p.category,
    tags: p.tags,
    date: p.date,
    track: p.track,
  }));
}

/**
 * 글 목록(PostListClient·PostCard)용 글 메타 — 본문(content)만 제외.
 * 클라이언트 컴포넌트로 직렬화되는 RSC 페이로드를 줄인다.
 * 카드 렌더·카테고리/태그 필터에 필요한 메타는 모두 유지한다.
 */
export type PostListItem = Omit<PostData, 'content'>;

/** PostData에서 본문(content)을 제거한 목록용 메타로 변환 */
export function toListItem(p: PostData): PostListItem {
  return {
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    category: p.category,
    tags: p.tags,
    series: p.series,
    date: p.date,
    type: p.type,
    track: p.track,
  };
}

export function getEssaysList(): PostListItem[] {
  return getEssays().map(toListItem);
}

export interface Heading {
  id: string;
  text: string;
  level: number;
}

export function extractHeadings(content: string): Heading[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: Heading[] = [];
  const idCount: Record<string, number> = {};
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    let id = text
      .toLowerCase()
      .replace(/[^a-z0-9가-힣\s-]/g, '')
      .replace(/\s+/g, '-');

    if (idCount[id] !== undefined) {
      idCount[id]++;
      id = `${id}-${idCount[id]}`;
    } else {
      idCount[id] = 0;
    }

    headings.push({ id, text, level });
  }

  return headings;
}
