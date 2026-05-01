import NextLink from 'next/link';
import type { ComponentProps } from 'react';

type LinkProps = ComponentProps<typeof NextLink>;

/**
 * 정적 export 블로그용 Link 래퍼
 *
 * prefetch 기본값을 false로 뒤집습니다. Next.js 16 기본값('auto')은
 * viewport에 들어오는 모든 Link의 RSC payload를 동시 prefetch해서,
 * 글 카드가 200+ 깔리는 목록 페이지에서 동시 연결 한계(~6)를 초과하고
 * `__next._tree.txt` 요청이 (pending) 큐에 쌓여 사이트가 멈춥니다.
 *
 * 정적 export는 RSC payload가 빌드 시 정적 파일이라 클릭 시 fetch가 충분히
 * 빠릅니다. prefetch를 끄는 비용은 거의 없고, 폭주를 원천 차단하는 이득이 큽니다.
 *
 * 특정 위치에서 prefetch를 켜야 한다면 `<Link prefetch={true}>` 또는
 * `<Link prefetch="auto">`로 명시적으로 opt-in 가능합니다.
 */
export default function Link({ prefetch = false, ...props }: LinkProps) {
  return <NextLink prefetch={prefetch} {...props} />;
}
