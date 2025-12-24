import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import TOC from '@/components/TOC';
import Sidebar from '@/components/Sidebar';
import SeriesNav from '@/components/SeriesNav';
import { getAllPosts, getPostBySlug, getSeriesPosts, extractHeadings } from '@/lib/posts';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { mdxComponents } from '@/components/MDXComponents';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const posts = getAllPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const allPosts = getAllPosts();
  const headings = extractHeadings(post.content);
  const seriesPosts = post.series ? getSeriesPosts(post.series.name) : [];

  const formattedDate = new Date(post.date).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <>
      <Header posts={allPosts} />
      <Sidebar posts={allPosts} />

      <main className="pt-24 pb-16 lg:pl-64">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-8">
            {/* Article */}
            <article className="flex-1 min-w-0">
              {/* Post Header */}
              <header className="mb-8">
                <div className="flex gap-2 mb-3">
                  <span className="px-2 py-1 bg-[var(--accent)]/20 text-[var(--accent)] text-sm rounded">
                    {post.category}
                  </span>
                  {post.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-sm rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <h1 className="text-3xl font-bold mb-4">{post.title}</h1>
                {post.excerpt && (
                  <p className="text-[var(--text-secondary)] text-lg mb-4">
                    {post.excerpt}
                  </p>
                )}
                <time className="text-[var(--text-muted)] text-sm">{formattedDate}</time>
              </header>

              {/* Series Navigation (Top) */}
              {post.series && seriesPosts.length > 0 && (
                <SeriesNav
                  seriesName={post.series.name}
                  currentOrder={post.series.order}
                  posts={seriesPosts}
                />
              )}

              {/* Post Content */}
              <div className="prose">
                <MDXRemote source={post.content} components={mdxComponents} />
              </div>

              {/* Series Navigation (Bottom) */}
              {post.series && seriesPosts.length > 0 && (
                <div className="mt-12">
                  <SeriesNav
                    seriesName={post.series.name}
                    currentOrder={post.series.order}
                    posts={seriesPosts}
                    showList={false}
                  />
                </div>
              )}
            </article>

            {/* TOC Sidebar */}
            <aside className="hidden xl:block w-64 shrink-0">
              <div className="sticky top-24">
                <TOC headings={headings} />
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
