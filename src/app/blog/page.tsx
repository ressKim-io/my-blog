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
          <BlogList posts={posts} />
        </div>
      </main>
    </>
  );
}
