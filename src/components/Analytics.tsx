'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

// 방문자 분석 백엔드(Cloudflare Worker) base URL. 빌드 시 주입되며,
// 미설정이면(로컬·env 없음) 아무 것도 전송하지 않는다.
const ENDPOINT = process.env.NEXT_PUBLIC_ANALYTICS_URL;

/**
 * 경로가 바뀔 때마다 페이지뷰 비콘을 Worker로 보낸다.
 * 이 블로그는 클릭 시 클라이언트 이동(next/link)이 많아, 최초 로드만 잡는
 * 기본 스크립트로는 SPA 이동이 집계되지 않으므로 usePathname으로 직접 카운트한다.
 * sendBeacon + text/plain 이라 CORS preflight 없이 fire-and-forget으로 전송된다.
 */
export default function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!ENDPOINT) return;
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    // 로컬 개발 환경은 집계 제외
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;

    const body = JSON.stringify({ p: pathname, r: document.referrer });
    try {
      navigator.sendBeacon(`${ENDPOINT}/collect`, new Blob([body], { type: 'text/plain' }));
    } catch {
      // 전송 실패는 무시 (분석은 부가 기능)
    }
  }, [pathname]);

  return null;
}
