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

// 슬러그/시리즈 이름에 강하게 트러블슈팅을 시사하는 영문 키워드
const TROUBLESHOOT_SLUG_PATTERNS = [
  /troubleshoot/i,
  /crashloop/i,
  /-fix(-|$)/i,
  /-bug(-|$)/i,
  /-debug(-|$)/i,
  /(^|-)error(-|$)/i,
  /-?exception(-|$)/i,
  /-?failure(-|$)/i,
  /-?timeout(-|$)/i,
  /-?missing(-|$)/i,
  /-?investigation(-|$)/i,
  /-?audit(-|$)/i,
  /-?recovery(-|$)/i,
  /-?regression(-|$)/i,
  /-?incident(-|$)/i,
  /-?outage(-|$)/i,
  /-?broken(-|$)/i,
  /(^|-)oom(-|$)/i,
  /-?deadlock(-|$)/i,
  /-?mismatch(-|$)/i,
  /-?conflict(-|$)/i,
  /-?nodata(-|$)/i,
  /-?imagepullbackoff(-|$)/i,
  /-?(40[0-9]|50[0-9])(-|$)/, // HTTP 4xx/5xx
  /syntax-error/i,
  /parsing-error/i,
  /not-found/i,
  /false-negative/i,
];

function looksLikeTroubleshooting(slug: string, seriesName: string | undefined): boolean {
  return TROUBLESHOOT_SLUG_PATTERNS.some(
    (re) => re.test(slug) || (seriesName !== undefined && re.test(seriesName)),
  );
}

function inferType(
  data: matter.GrayMatterFile<string>['data'],
  slug: string,
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
  // 슬러그에 -adr 명시적이면 adr로
  if (/-adr(-|$)/i.test(slug)) return 'adr';
  // 슬러그/시리즈에 트러블슈팅 영문 키워드
  if (looksLikeTroubleshooting(slug, data.series?.name)) return 'troubleshooting';
  return undefined;
}

function inferTrack(type: PostType | undefined): Track {
  if (type === 'troubleshooting') return 'logs';
  return 'essays';
}

function readPost(fileName: string): PostData {
  const slug = fileName.replace(/\.md$/, '');
  const fullPath = path.join(postsDirectory, fileName);
  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const parsed = matter(fileContents);
  const { data, content } = parsed;
  const type = inferType(data, slug);
  const track = inferTrack(type);

  return {
    slug,
    title: data.title,
    excerpt: data.excerpt,
    category: data.category,
    tags: data.tags,
    series: data.series,
    date: data.date,
    content,
    type,
    track,
    readingTime: estimateReadingTime(content),
  };
}

let cachedPosts: PostData[] | null = null;

export function getAllPosts(): PostData[] {
  if (cachedPosts) return cachedPosts;
  if (!fs.existsSync(postsDirectory)) return [];

  const fileNames = fs.readdirSync(postsDirectory).filter((f) => f.endsWith('.md'));
  const posts = fileNames.map(readPost).sort((a, b) => (a.date < b.date ? 1 : -1));
  cachedPosts = posts;
  return posts;
}

export function getPostBySlug(slug: string): PostData | null {
  const fullPath = path.join(postsDirectory, `${slug}.md`);
  if (!fs.existsSync(fullPath)) return null;
  return readPost(`${slug}.md`);
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
