import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import RedirectClient from '@/components/RedirectClient';
import { getAllPosts, getPostBySlug } from '@/lib/posts';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  return {
    title: post.title,
    alternates: { canonical: `/${post.track}/${slug}/` },
    robots: { index: false, follow: true },
  };
}

export default async function BlogPostRedirect({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  return (
    <>
      <Header posts={getAllPosts()} />
      <RedirectClient href={`/${post.track}/${slug}`} label={`${post.title}로 이동`} />
      <Footer />
    </>
  );
}
