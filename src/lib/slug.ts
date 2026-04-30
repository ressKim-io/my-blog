/** href에서 내부 글 슬러그 추출. 외부 링크나 매칭 안 되면 undefined. */
export function slugFromHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const m = href.match(/^\/(essays|logs|projects)\/([^/?#]+)\/?$/);
  return m?.[2];
}
