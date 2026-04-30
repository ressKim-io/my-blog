import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PostDetail from '@/components/PostDetail';
import { getAllPosts, getPostBySlug, getEssays, getSeriesPosts } from '@/lib/posts';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getEssays().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || post.track !== 'essays') return {};

  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/essays/${slug}/` },
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

export default async function EssayPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || post.track !== 'essays') notFound();

  const allPosts = getAllPosts();
  const seriesPosts = post.series ? getSeriesPosts(post.series.name) : [];

  return (
    <>
      <Header posts={allPosts} />
      <PostDetail post={post} allPosts={allPosts} seriesPosts={seriesPosts} />
      <Footer />
    </>
  );
}
