import CodeBlock from './CodeBlock';
import MDXLink from './MDXLink';

interface CodeProps {
  className?: string;
  children?: React.ReactNode;
}

const basePath = process.env.NODE_ENV === 'production' ? '/my-blog' : '';

function slugify(children: React.ReactNode): string {
  if (typeof children !== 'string') {
    if (Array.isArray(children)) {
      return slugify(children.filter((c) => typeof c === 'string').join(''));
    }
    return '';
  }
  return children
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-');
}

export const mdxComponents = {
  img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const srcString = typeof src === 'string' ? src : '';
    const imageSrc = srcString.startsWith('/') ? `${basePath}${srcString}` : srcString;

    const altString = alt ?? '';
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
      const { className, children: codeChildren } = codeElement.props;
      return <CodeBlock className={className}>{codeChildren}</CodeBlock>;
    }
    return <pre {...props}>{children}</pre>;
  },

  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    if (className?.includes('language-')) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code {...props}>
        {children}
      </code>
    );
  },

  a: MDXLink,

  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
    const id = slugify(children);
    return (
      <h2 id={id} className="group relative scroll-mt-20" {...props}>
        <a
          href={`#${id}`}
          aria-label={`${typeof children === 'string' ? children : 'section'} 링크`}
          className="absolute -left-6 top-1/2 -translate-y-1/2 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity hover:!text-[var(--accent)] no-underline"
          style={{ textDecoration: 'none' }}
        >
          #
        </a>
        {children}
      </h2>
    );
  },

  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
    const id = slugify(children);
    return (
      <h3 id={id} className="group relative scroll-mt-20" {...props}>
        <a
          href={`#${id}`}
          aria-label={`${typeof children === 'string' ? children : 'section'} 링크`}
          className="absolute -left-5 top-1/2 -translate-y-1/2 text-[var(--muted)] opacity-0 group-hover:opacity-100 transition-opacity hover:!text-[var(--accent)] no-underline"
          style={{ textDecoration: 'none' }}
        >
          #
        </a>
        {children}
      </h3>
    );
  },
};
