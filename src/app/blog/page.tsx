import { Suspense } from 'react';
import Header from '@/components/Header';
import BlogList from '@/components/BlogList';
import { getAllPosts } from '@/lib/posts';

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <>
      <Header posts={posts} />

      <main className="pt-20 pb-16">
        <div className="max-w-5xl mx-auto px-4">
          <h1 className="text-2xl font-bold mb-8 tracking-tight">Posts</h1>
          <Suspense fallback={<BlogListSkeleton />}>
            <BlogList posts={posts} />
          </Suspense>
        </div>
      </main>
    </>
  );
}

function BlogListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 w-24 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-36 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}
