/**
 * 프로덕션(GitHub Pages)은 /my-blog 하위에 배포됩니다.
 * next/link·next/router는 basePath를 자동으로 붙이지만
 * 생 <a>·<img>는 직접 붙여야 합니다 (next.config.ts의 basePath와 값이 같아야 함)
 */
export const basePath = process.env.NODE_ENV === 'production' ? '/my-blog' : '';

/** 내부 절대경로에 basePath를 붙입니다. 외부 URL·프로토콜 상대경로·해시·상대경로는 그대로 */
export function withBasePath(href: string | undefined): string | undefined {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return href;
  return `${basePath}${href}`;
}
