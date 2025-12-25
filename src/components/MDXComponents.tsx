import CodeBlock from './CodeBlock';

interface CodeProps {
  className?: string;
  children?: React.ReactNode;
}

// basePath for production (GitHub Pages)
const basePath = process.env.NODE_ENV === 'production' ? '/my-blog' : '';

// MDX에서 사용할 커스텀 컴포넌트들
export const mdxComponents = {
  // 이미지 basePath 처리 (GitHub Pages)
  img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
    const srcString = typeof src === 'string' ? src : '';
    const imageSrc = srcString.startsWith('/') ? `${basePath}${srcString}` : srcString;

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageSrc}
        alt={alt || ''}
        className="max-w-full h-auto my-4 rounded-lg max-h-[500px] w-auto mx-auto block"
        loading="lazy"
        {...props}
      />
    );
  },
  // pre 태그를 CodeBlock으로 대체
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => {
    // children이 code 요소인지 확인
    const codeElement = children as React.ReactElement<CodeProps>;

    if (codeElement?.type === 'code') {
      const { className, children: codeChildren } = codeElement.props as CodeProps;
      return (
        <CodeBlock className={className}>
          {codeChildren}
        </CodeBlock>
      );
    }

    return <pre {...props}>{children}</pre>;
  },

  // 인라인 코드 스타일링
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    // 코드 블록 내부의 code는 그대로 반환 (pre에서 처리)
    if (className?.includes('language-')) {
      return <code className={className} {...props}>{children}</code>;
    }

    // 인라인 코드
    return (
      <code
        className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded text-sm font-mono"
        {...props}
      >
        {children}
      </code>
    );
  },

  // 테이블 스타일링
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-6">
      <table className="w-full border-collapse" {...props}>
        {children}
      </table>
    </div>
  ),

  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th
      className="border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-2 text-left font-semibold"
      {...props}
    >
      {children}
    </th>
  ),

  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-[var(--border)] px-4 py-2" {...props}>
      {children}
    </td>
  ),

  // 블록쿼트 스타일링
  blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="border-l-4 border-[var(--accent)] pl-4 my-6 text-[var(--text-muted)] italic"
      {...props}
    >
      {children}
    </blockquote>
  ),

  // 링크 스타일링
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

  // 헤딩에 앵커 추가
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
    const id = typeof children === 'string'
      ? children.toLowerCase().replace(/[^a-z0-9가-힣\s-]/g, '').replace(/\s+/g, '-')
      : '';

    return (
      <h2 id={id} className="group" {...props}>
        {children}
        <a href={`#${id}`} className="ml-2 opacity-0 group-hover:opacity-100 text-[var(--text-muted)]">
          #
        </a>
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
        <a href={`#${id}`} className="ml-2 opacity-0 group-hover:opacity-100 text-[var(--text-muted)]">
          #
        </a>
      </h3>
    );
  },
};
