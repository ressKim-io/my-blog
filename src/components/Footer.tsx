import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--border)]">
      <div className="max-w-[1100px] mx-auto px-5 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="text-[13px] text-[var(--muted)]">© 2026 Ress · Learning by doing</div>
        <nav className="flex items-center gap-5 text-[13px]">
          <Link href="/" className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            Home
          </Link>
          <Link href="/about" className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            About
          </Link>
          <a
            href="https://github.com/resskim-io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            GitHub
          </a>
          <a
            href="/feed.xml"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            RSS
          </a>
        </nav>
      </div>
    </footer>
  );
}
