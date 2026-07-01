import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PostDetail from '@/components/PostDetail';
import { getAllPosts, getPostBySlug, getLogs, getSeriesPosts, getSearchIndex } from '@/lib/posts';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getLogs().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || post.track !== 'logs') return {};

  return {
    title: post.title,
    description: post.excerpt,
    // logs 트랙 격리: 공개(URL 직접 접근)는 유지하되 검색엔진 색인은 차단한다.
    // robots.txt Disallow가 아닌 noindex 메타를 쓰는 이유 — Disallow면 크롤러가
    // 페이지를 못 읽어 noindex 태그도 못 보고 URL만 색인될 수 있다.
    robots: { index: false, follow: false },
    alternates: { canonical: `/logs/${slug}/` },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.excerpt,
      publishedTime: post.date,
      section: post.category,
      tags: post.tags,
    },
  };
}

export default async function LogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || post.track !== 'logs') notFound();

  const allPosts = getAllPosts();
  const seriesPosts = post.series ? getSeriesPosts(post.series.name) : [];

  return (
    <>
      <Header posts={getSearchIndex()} />
      <PostDetail post={post} allPosts={allPosts} seriesPosts={seriesPosts} />
      <Footer />
    </>
  );
}
