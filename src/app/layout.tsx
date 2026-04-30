import type { Metadata } from "next";
import "./globals.css";
import { getAllPosts } from "@/lib/posts";
import { PostsIndexProvider, type PostMeta } from "@/components/PostsIndexProvider";

const SITE_URL = "https://resskim-io.github.io/my-blog";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Ress Blog",
    template: "%s | Ress Blog",
  },
  description: "Learning by doing, documenting the journey",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "Ress Blog",
  },
  twitter: {
    card: "summary",
  },
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
};

const siteSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: 'Ress Blog',
      description: 'Learning by doing, documenting the journey',
      inLanguage: 'ko',
      publisher: { '@id': `${SITE_URL}/#person` },
    },
    {
      '@type': 'Person',
      '@id': `${SITE_URL}/#person`,
      name: 'Ress',
      url: SITE_URL,
      sameAs: ['https://github.com/ressKim-io'],
    },
  ],
};
const siteJsonLd = JSON.stringify(siteSchema).replace(/</g, '\\u003c');

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const postsIndex: PostMeta[] = getAllPosts().map((p) => ({
    slug: p.slug,
    track: p.track,
    title: p.title,
    excerpt: p.excerpt,
    date: p.date,
    type: p.type,
    category: p.category,
    readingTime: p.readingTime,
  }));

  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: siteJsonLd }}
        />
      </head>
      <body className="antialiased">
        <PostsIndexProvider posts={postsIndex}>{children}</PostsIndexProvider>
      </body>
    </html>
  );
}
