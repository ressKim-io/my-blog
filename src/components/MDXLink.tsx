import type { AnchorHTMLAttributes } from 'react';
import LinkPreview from './LinkPreview';
import { slugFromHref } from '@/lib/slug';

/**
 * MDX 본문의 a 태그.
 * - 외부 링크: 새 창 + noopener
 * - 내부 글 링크: LinkPreview로 위키 스타일 호버 미리보기
 * - 그 외 내부 링크: 일반 a
 */
export default function MDXLink({
  children,
  href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isExternal = href?.startsWith('http');
  const isInternalPost = !isExternal && slugFromHref(href);

  if (isInternalPost) {
    return (
      <LinkPreview href={href} {...props}>
        {children}
      </LinkPreview>
    );
  }

  return (
    <a
      href={href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      {...props}
    >
      {children}
    </a>
  );
}
