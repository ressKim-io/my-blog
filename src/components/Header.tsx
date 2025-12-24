import Link from 'next/link';
import Search from './Search';
import ThemeToggle from './ThemeToggle';

interface Post {
  slug: string;
  title: string;
  excerpt?: string;
  category: string;
  tags?: string[];
  date: string;
}

interface HeaderProps {
  posts?: Post[];
}

export default function Header({ posts = [] }: HeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[var(--bg-primary)]/80 backdrop-blur-md border-b border-[var(--border)]">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-[var(--text-primary)]">
          Ress Blog
        </Link>
        <div className="flex items-center gap-4">
          <Search posts={posts} />
          <ThemeToggle />
          <nav className="flex gap-6">
            <Link href="/" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Home
            </Link>
            <Link href="/blog" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Blog
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
