'use client';

interface CategoryNavProps {
  categories: { name: string; label: string; count: number }[];
  selected: string | null;
  onSelect: (category: string | null) => void;
  totalCount: number;
}

export default function CategoryNav({ categories, selected, onSelect, totalCount }: CategoryNavProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onSelect(null)}
        className={`
          px-4 py-2 rounded-lg text-sm font-medium transition-colors
          ${selected === null
            ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
          }
        `}
      >
        All ({totalCount})
      </button>
      {categories.map((cat) => (
        <button
          key={cat.name}
          onClick={() => onSelect(cat.name)}
          className={`
            px-4 py-2 rounded-lg text-sm font-medium transition-colors
            ${selected === cat.name
              ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }
          `}
        >
          {cat.label} ({cat.count})
        </button>
      ))}
    </div>
  );
}
