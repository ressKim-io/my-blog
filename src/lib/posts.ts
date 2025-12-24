import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const postsDirectory = path.join(process.cwd(), 'src/content');

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
}

export function getAllPosts(): PostData[] {
  if (!fs.existsSync(postsDirectory)) {
    return [];
  }

  const fileNames = fs.readdirSync(postsDirectory).filter(f => f.endsWith('.md'));

  const posts = fileNames.map((fileName) => {
    const slug = fileName.replace(/\.md$/, '');
    const fullPath = path.join(postsDirectory, fileName);
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(fileContents);

    return {
      slug,
      title: data.title,
      excerpt: data.excerpt,
      category: data.category,
      tags: data.tags,
      series: data.series,
      date: data.date,
      content,
    } as PostData;
  });

  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostBySlug(slug: string): PostData | null {
  const fullPath = path.join(postsDirectory, `${slug}.md`);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const { data, content } = matter(fileContents);

  return {
    slug,
    title: data.title,
    excerpt: data.excerpt,
    category: data.category,
    tags: data.tags,
    series: data.series,
    date: data.date,
    content,
  } as PostData;
}

export function getSeriesPosts(seriesName: string): PostData[] {
  const allPosts = getAllPosts();
  return allPosts
    .filter(post => post.series?.name === seriesName)
    .sort((a, b) => (a.series?.order || 0) - (b.series?.order || 0));
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

    // 중복 ID 처리: 같은 ID가 이미 있으면 숫자 추가
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
