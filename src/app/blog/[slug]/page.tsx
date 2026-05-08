import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import RedirectClient from '@/components/RedirectClient';
import { getAllPosts, getEssays, getPostBySlug } from '@/lib/posts';

interface Props {
  params: Promise<{ slug: string }>;
}

// /blog/{slug}는 essays 호환 redirect 경로. logs 글은 격리 정책에 따라
// 빌드에서 제외 — /logs/{slug} 직접 입력으로만 접근 가능.
export async function generateStaticParams() {
  return getEssays().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || post.track !== 'essays') return {};
  return {
    title: post.title,
    alternates: { canonical: `/essays/${slug}/` },
    robots: { index: false, follow: true },
  };
}

export default async function BlogPostRedirect({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || post.track !== 'essays') notFound();

  return (
    <>
      <Header posts={getAllPosts()} />
      <RedirectClient href={`/essays/${slug}`} label={`${post.title}로 이동`} />
      <Footer />
    </>
  );
}
