import { getPublicationDate, isPostPublished } from './publication.mjs';

// 검토가 끝나면 false로 바꿉니다. 이후에는 게시일에 맞춰 목록에 노출됩니다.
const PREVIEW_K8S_THEORY = true;

/** @param {{ slug: string }} post */
export function isPostListed(post) {
  return !(PREVIEW_K8S_THEORY && post.slug.startsWith('k8s-theory-'));
}

/** @param {{ slug: string, date: string }} post */
export function isPostAccessible(post, today = getPublicationDate()) {
  // 링크로 검토하는 글은 예약일 전에도 읽을 수 있어야 시리즈 이동이 끊기지 않습니다.
  return !isPostListed(post) || isPostPublished(post.date, today);
}
