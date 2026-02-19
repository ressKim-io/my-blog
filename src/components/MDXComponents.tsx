import CodeBlock from './CodeBlock';

interface CodeProps {
  className?: string;
  children?: React.ReactNode;
}

const basePath = process.env.NODE_ENV === 'production' ? '/my-blog' : '';

export const mdxComponents = {
  img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const srcString = typeof src === 'string' ? src : '';
    const imageSrc = srcString.startsWith('/') ? `${basePath}${srcString}` : srcString;

    const altString = alt || '';
    const sizeMatch = altString.match(/\|(xtall|tall|short|auto)$/);
    const sizeHint = sizeMatch ? sizeMatch[1] : null;
    const cleanAlt = altString.replace(/\|(xtall|tall|short|auto)$/, '').trim();

    const sizeClasses: Record<string, string> = {
      xtall: 'max-h-[1600px]',
      tall: 'max-h-[1100px]',
      short: 'max-h-[600px]',
      auto: '',
    };

    const heightClass = sizeHint ? sizeClasses[sizeHint] : 'max-h-[800px]';

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageSrc}
        alt={cleanAlt}
        className={`max-w-full h-auto my-4 rounded-lg w-auto mx-auto block ${heightClass}`}
        loading="lazy"
        {...props}
      />
    );
  },

  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => {
    const codeElement = children as React.ReactElement<CodeProps>;
    if (codeElement?.type === 'code') {
      const { className, children: codeChildren } = codeElement.props as CodeProps;
      return <CodeBlock className={className}>{codeChildren}</CodeBlock>;
    }
    return <pre {...props}>{children}</pre>;
  },

  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    if (className?.includes('language-')) {
      return <code className={className} {...props}>{children}</code>;
    }
    return (
      <code className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded text-[0.85em] font-mono" {...props}>
        {children}
      </code>
    );
  },

  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-6">
      <table className="w-full border-collapse text-[0.95em]" {...props}>{children}</table>
    </div>
  ),

  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2 text-left font-semibold text-[var(--text-primary)]" {...props}>
      {children}
    </th>
  ),

  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-[var(--border)] px-4 py-2 text-[var(--text-secondary)]" {...props}>
      {children}
    </td>
  ),

  blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="border-l-2 border-[var(--border-hover)] pl-4 my-6 text-[var(--text-muted)] italic" {...props}>
      {children}
    </blockquote>
  ),

  a: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      {...props}
    >
      {children}
    </a>
  ),

  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
    const id = typeof children === 'string'
      ? children.toLowerCase().replace(/[^a-z0-9가-힣\s-]/g, '').replace(/\s+/g, '-')
      : '';
    return (
      <h2 id={id} className="group" {...props}>
        {children}
        <a href={`#${id}`} className="ml-2 opacity-0 group-hover:opacity-100 text-[var(--text-muted)]">#</a>
      </h2>
    );
  },

  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
    const id = typeof children === 'string'
      ? children.toLowerCase().replace(/[^a-z0-9가-힣\s-]/g, '').replace(/\s+/g, '-')
      : '';
    return (
      <h3 id={id} className="group" {...props}>
        {children}
        <a href={`#${id}`} className="ml-2 opacity-0 group-hover:opacity-100 text-[var(--text-muted)]">#</a>
      </h3>
    );
  },
};
