import { Suspense } from 'react';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import BlogList from '@/components/BlogList';
import { getAllPosts } from '@/lib/posts';

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <>
      <Header posts={posts} />
      <Sidebar posts={posts} />

      <main className="pt-24 pb-16 lg:pl-64">
        <div className="max-w-4xl mx-auto px-4">
          <h1 className="text-2xl font-bold mb-6">All Posts</h1>
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
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-[var(--bg-secondary)] rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}
