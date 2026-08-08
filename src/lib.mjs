// 스토어 알림의 순수 로직 — 피드 파싱, 새 리뷰·평점 변동 감지, 디스코드 embed 생성
export const APP_STORE_ID = '6787414201';
export const PLAY_PACKAGE = 'com.saynow.app';

export const APP_STORE_URL = `https://apps.apple.com/kr/app/id${APP_STORE_ID}`;
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
const ASC_URL = `https://appstoreconnect.apple.com/apps/${APP_STORE_ID}/distribution`;

const ICONS = {
  appStore: 'https://cdn.discordapp.com/emojis/1535598212247978044.png',
  playStore: 'https://cdn.discordapp.com/emojis/1535598213959000115.png',
};
const EMOJIS = {
  appStore: '<:appstore:1535598212247978044>',
  playStore: '<:playstore:1535598213959000115>',
};
const NAMES = { appStore: 'App Store', playStore: 'Play Store' };

const COLORS = {
  green: 0x57f287,
  yellow: 0xfee75c,
  red: 0xed4245,
  blue: 0x3498db,
  purple: 0x9b59b6,
  orange: 0xef9f27,
};

export const starLine = (rating) => '⭐'.repeat(rating);

export const ratingColor = (rating) => {
  if (rating >= 4) return COLORS.green;
  if (rating === 3) return COLORS.yellow;
  return COLORS.red;
};

// 피드는 최신순으로 오므로, 안 본 것만 골라 오래된 순으로 뒤집는다
export const diffNewReviews = (reviews, seenIds) => {
  const seen = new Set(seenIds);
  return reviews.filter((r) => !seen.has(r.id)).reverse();
};

export const parseAppStoreFeed = (json) => {
  const entries = json?.feed?.entry;
  if (!entries) return [];
  return (Array.isArray(entries) ? entries : [entries]).map((e) => ({
    id: e.id?.label ?? '',
    author: e.author?.name?.label ?? '',
    rating: Number(e['im:rating']?.label ?? 0),
    title: e.title?.label ?? '',
    body: e.content?.label ?? '',
    version: e['im:version']?.label ?? '',
  }));
};

export const parseAppStoreLookup = (json) => {
  const app = json?.results?.[0];
  if (!app) return null;
  return {
    version: app.version,
    releaseNotes: app.releaseNotes ?? null,
    rating: Math.round(app.averageUserRating * 10) / 10,
    ratingCount: app.userRatingCount,
  };
};

// 플레이 페이지는 공식 API가 없어 스크립트 데이터의 패턴을 읽는다. 못 찾으면 null로 조용히 넘어간다
export const parsePlayStorePage = (html) => {
  const version = html.match(/\[\[\["([\d.]+)"\]\]/)?.[1] ?? null;
  const ratingRaw = html.match(/"starRating":([\d.]+)/)?.[1];
  const rating = ratingRaw ? Math.round(Number(ratingRaw) * 10) / 10 : null;
  return { version, rating };
};

export const detectRatingChanges = (prev, curr) => {
  const changeOf = (store) => {
    const before = prev?.[store]?.rating;
    const after = curr[store]?.rating;
    if (before == null || after == null || before === after) return null;
    return { direction: after < before ? 'down' : 'up', from: before };
  };

  const appStore = changeOf('appStore');
  const playStore = changeOf('playStore');
  if (!appStore && !playStore) return null;
  return { appStore, playStore };
};

// 답글 링크는 콘솔 리뷰 페이지의 정확한 URL이 확보되면 메타 줄에 추가한다
const reviewMeta = (review) => {
  const parts = [review.author, `v${review.version}`];
  if (review.device) parts.push(review.device);
  return parts.join(' · ');
};

export const buildReviewEmbed = (store, review) => {
  const title = review.title ? `**${review.title}**\n` : '';
  return {
    author: { name: NAMES[store], icon_url: ICONS[store] },
    title: starLine(review.rating),
    description: `${title}${review.body}\n\n${reviewMeta(review)}`,
    color: ratingColor(review.rating),
    timestamp: new Date().toISOString(),
  };
};

export const buildReleaseEmbed = (store, { version, releaseNotes }) => {
  const notes = releaseNotes ? `**릴리즈 노트**\n${releaseNotes}\n\n` : '';
  const link =
    store === 'appStore'
      ? `[App Store에서 보기](${APP_STORE_URL})`
      : `[Play Store에서 보기](${PLAY_STORE_URL})`;
  return {
    author: { name: NAMES[store], icon_url: ICONS[store] },
    title: `🚀 랜딧 ${version} 공개됨`,
    description: `${notes}${link}`,
    color: COLORS.blue,
    timestamp: new Date().toISOString(),
  };
};

export const buildReviewApprovedEmbed = (version) => ({
  author: { name: NAMES.appStore, icon_url: ICONS.appStore },
  title: `✅ ${version} 심사 통과 — 출시 대기 중`,
  description: `출시 버튼을 누르면 배포됩니다. [App Store Connect 열기](${ASC_URL})`,
  color: COLORS.purple,
  timestamp: new Date().toISOString(),
});

export const buildReviewRejectedEmbed = (version) => ({
  author: { name: NAMES.appStore, icon_url: ICONS.appStore },
  title: `❌ ${version} 심사 거절`,
  description: `사유는 App Store Connect에서 확인하세요. [열기](${ASC_URL})`,
  color: COLORS.red,
  timestamp: new Date().toISOString(),
});

export const buildRatingChangeMessage = (changes, curr) => {
  const line = (store) => {
    const { rating, ratingCount } = curr[store];
    if (rating == null) return `${EMOJIS[store]} ${NAMES[store]} 평점 집계 전`;
    const change = changes[store];
    const value = change
      ? `**${change.from} → ${rating}** ${change.direction === 'down' ? '▼' : '▲'} ${
          Math.round(Math.abs(rating - change.from) * 10) / 10
        }`
      : `**${rating}** 변동 없음`;
    return `${EMOJIS[store]} ${NAMES[store]} ${value} · 리뷰 ${ratingCount}개`;
  };

  const hasDown = Object.values(changes).some((c) => c?.direction === 'down');
  return {
    title: '평점 변동이 있어요',
    description: `${line('appStore')}\n${line('playStore')}`,
    color: hasDown ? COLORS.orange : COLORS.green,
    timestamp: new Date().toISOString(),
  };
};
