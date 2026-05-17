import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import RedirectClient from '@/components/RedirectClient';
import { getSearchIndex } from '@/lib/posts';

export const metadata: Metadata = {
  title: 'Posts',
  alternates: { canonical: '/essays/' },
  robots: { index: false, follow: true },
};

export default function BlogIndex() {
  return (
    <>
      <Header posts={getSearchIndex()} />
      <RedirectClient href="/essays" label="Essays로 이동" />
      <Footer />
    </>
  );
}
