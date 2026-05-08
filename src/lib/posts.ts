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
  readingTime: number;
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
    readingTime: estimateReadingTime(content),
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
 * 한국어 250자/분, 영문 200단어/분 가중 평균.
 * 코드블록은 본문보다 천천히 읽힌다고 가정해 0.5x 가중.
 */
export function estimateReadingTime(content: string): number {
  const codeBlocks = content.match(/```[\s\S]*?```/g) ?? [];
  const codeChars = codeBlocks.reduce((sum, block) => sum + block.length, 0);
  const stripped = content.replace(/```[\s\S]*?```/g, '');

  const koreanChars = (stripped.match(/[가-힣]/g) ?? []).length;
  const englishWords = (stripped.match(/[a-zA-Z][a-zA-Z'-]*/g) ?? []).length;

  const minutes =
    koreanChars / 250 + englishWords / 200 + codeChars / 500;
  return Math.max(1, Math.ceil(minutes));
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
