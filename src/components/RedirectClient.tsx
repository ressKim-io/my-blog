'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RedirectClient({ href, label }: { href: string; label?: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [href, router]);
  return (
    <main className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <p className="text-[14px] text-[var(--muted)] mb-3">이동 중…</p>
        <Link href={href} className="text-[14px] text-[var(--accent)] hover:opacity-70 transition-opacity">
          {label ?? '새 URL로 이동'} →
        </Link>
      </div>
    </main>
  );
}
