'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';

interface CategoryItem {
  name: string;
  label: string;
  count: number;
}

interface CategoryFilterProps {
  categories: CategoryItem[];
  totalCount: number;
}

export default function CategoryFilter({ categories, totalCount }: CategoryFilterProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selected = searchParams.get('category');

  const select = (cat: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (cat) params.set('category', cat);
    else params.delete('category');
    params.delete('page');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const itemCls = (active: boolean) =>
    `px-3.5 py-1.5 rounded-full text-[13px] transition-colors ${
      active
        ? 'bg-[var(--text)] text-white'
        : 'bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--border)]'
    }`;

  return (
    <div className="flex flex-wrap gap-2 mb-8">
      <button onClick={() => select(null)} className={itemCls(!selected)}>
        All <span className="opacity-60">{totalCount}</span>
      </button>
      {categories.map((c) => (
        <button
          key={c.name}
          onClick={() => select(c.name)}
          className={itemCls(selected === c.name)}
        >
          {c.label} <span className="opacity-60">{c.count}</span>
        </button>
      ))}
    </div>
  );
}
