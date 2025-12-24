import Link from 'next/link';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { getAllPosts } from '@/lib/posts';

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <>
      <Header posts={posts} />
      <Sidebar posts={posts} />

      <main className="pt-24 pb-16 lg:pl-64">
        <div className="max-w-4xl mx-auto px-4">
          <h1 className="text-3xl font-bold mb-8">All Posts</h1>

          <div className="space-y-4">
            {posts.map((post) => (
              <article
                key={post.slug}
                className="p-5 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] hover:border-[var(--accent)]/50 transition-colors"
              >
                <Link href={`/blog/${post.slug}`} className="block">
                  <div className="flex gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-[var(--accent)]/20 text-[var(--accent)] text-xs rounded">
                      {post.category}
                    </span>
                    {post.series && (
                      <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded">
                        {post.series.name} #{post.series.order}
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2 hover:text-[var(--accent)] transition-colors">
                    {post.title}
                  </h2>
                  {post.excerpt && (
                    <p className="text-[var(--text-secondary)] text-sm mb-2 line-clamp-2">
                      {post.excerpt}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-[var(--text-muted)]">
                    <time>
                      {new Date(post.date).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </time>
                    {post.tags && post.tags.length > 0 && (
                      <div className="flex gap-2">
                        {post.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </article>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
