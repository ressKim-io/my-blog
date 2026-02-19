import { notFound } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import ReadingProgressBar from '@/components/ReadingProgressBar';
import SeriesNav from '@/components/SeriesNav';
import { getAllPosts, getPostBySlug, getSeriesPosts } from '@/lib/posts';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { mdxComponents } from '@/components/MDXComponents';
import remarkGfm from 'remark-gfm';

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
  const seriesPosts = post.series ? getSeriesPosts(post.series.name) : [];

  const formattedDate = new Date(post.date).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // 다음에 읽을 글: 같은 카테고리의 다른 글 중 최대 3개 (현재 글 제외, 최신순)
  const recommendedPosts = allPosts
    .filter((p) => p.category === post.category && p.slug !== post.slug)
    .slice(0, 3);

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <>
      <Header posts={allPosts} />
      <ReadingProgressBar />

      <main className="pt-20 pb-16">
        <div className="max-w-[780px] mx-auto px-4">
          {/* Article */}
          <article>
            {/* Post Header */}
            <header className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs text-[var(--text-muted)]">{post.category}</span>
                <span className="text-xs text-[var(--text-muted)]">{formattedDate}</span>
              </div>
              <h1 className="text-3xl font-bold mb-4 tracking-tight leading-tight">{post.title}</h1>
              {post.excerpt && (
                <p className="text-[var(--text-secondary)] text-lg leading-relaxed">
                  {post.excerpt}
                </p>
              )}
              {post.tags && post.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {post.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/blog?tag=${tag}`}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
              )}
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
              <MDXRemote
                source={post.content}
                components={mdxComponents}
                options={{
                  mdxOptions: {
                    remarkPlugins: [remarkGfm],
                  },
                }}
              />
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

          {/* 다음에 읽을 글 */}
          {recommendedPosts.length > 0 && (
            <section className="mt-16 pt-10 border-t border-[var(--border)]">
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-6 tracking-tight">
                다음에 읽을 글
              </h2>
              <div className="space-y-4">
                {recommendedPosts.map((rec) => (
                  <Link
                    key={rec.slug}
                    href={`/blog/${rec.slug}`}
                    className="group block p-5 bg-[var(--bg-secondary)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-[var(--text-muted)]">{rec.category}</span>
                      <span className="text-xs text-[var(--text-muted)]">{formatDate(rec.date)}</span>
                    </div>
                    <h3 className="font-medium text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors mb-2 leading-snug">
                      {rec.title}
                    </h3>
                    {rec.excerpt && (
                      <p className="text-sm text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                        {rec.excerpt}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
