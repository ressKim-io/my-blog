const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 빌드 머신의 시간대와 무관하게 한국 날짜로 공개 여부를 판단합니다.
export function getPublicationDate(now = new Date()) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** @param {string} date */
export function isPostPublished(date, today = getPublicationDate()) {
  return date <= today;
}
