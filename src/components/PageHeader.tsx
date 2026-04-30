type Track = 'essays' | 'logs' | 'projects';

interface PageHeaderProps {
  track?: Track;
  title: string;
  subtitle?: string;
  description?: string;
}

const trackColor: Record<Track, string> = {
  essays: 'var(--essays)',
  logs: 'var(--logs)',
  projects: 'var(--projects)',
};

export default function PageHeader({ track, title, subtitle, description }: PageHeaderProps) {
  const color = track ? trackColor[track] : 'var(--text)';

  return (
    <header className="mb-10">
      <div className="flex items-center gap-3">
        {track && (
          <span
            aria-hidden
            className="block w-1 self-stretch rounded-sm"
            style={{ background: color }}
          />
        )}
        <div className="flex-1 min-w-0">
          <h1
            className="text-[34px] md:text-[40px] font-bold leading-[1.15] tracking-tight"
            style={{ color }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-[15px] text-[var(--muted)]">{subtitle}</p>
          )}
        </div>
      </div>
      {description && (
        <p className="mt-5 text-[15px] leading-relaxed text-[var(--muted)] max-w-[640px]">
          {description}
        </p>
      )}
    </header>
  );
}
