// 스토어 알림의 순수 로직 — 피드 파싱, 새 리뷰·평점 변동 감지, 디스코드 embed 생성
export const APP_STORE_ID = '6787414201';
export const PLAY_PACKAGE = 'com.saynow.app';
const ASC_URL = `https://appstoreconnect.apple.com/apps/${APP_STORE_ID}/distribution`;

// 스토어 등록부 — 스토어의 정체성(이름·이모지·링크)은 전부 여기서 나온다
const STORES = {
  appStore: {
    name: 'App Store',
    emojiName: 'appstore',
    emojiId: '1535598212247978044',
    url: `https://apps.apple.com/kr/app/id${APP_STORE_ID}`,
  },
  playStore: {
    name: 'Play Store',
    emojiName: 'playstore',
    emojiId: '1535598213959000115',
    url: `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`,
  },
};
export const PLAY_STORE_URL = STORES.playStore.url;

const emoji = (store) =>
  `<:${STORES[store].emojiName}:${STORES[store].emojiId}>`;
const author = (store) => ({
  name: STORES[store].name,
  icon_url: `https://cdn.discordapp.com/emojis/${STORES[store].emojiId}.png`,
});

const COLORS = {
  green: 0x57f287,
  yellow: 0xfee75c,
  red: 0xed4245,
  blue: 0x3498db,
  purple: 0x9b59b6,
  orange: 0xef9f27,
};

const round1 = (n) => Math.round(n * 10) / 10;

// JWT 클라이언트(play·asc)가 공유하는 base64url 인코딩
export const base64url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

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

// 파서는 항상 같은 모양의 객체를 반환하고, 못 찾은 필드만 null이다 (null 반환은 수집 실패 전용)
export const parseAppStoreLookup = (json) => {
  const app = json?.results?.[0] ?? {};
  return {
    version: app.version ?? null,
    releaseNotes: app.releaseNotes ?? null,
    rating:
      app.averageUserRating != null ? round1(app.averageUserRating) : null,
    ratingCount: app.userRatingCount ?? null,
  };
};

// 플레이 페이지는 공식 API가 없어 스크립트 데이터의 패턴을 읽는다. 못 찾으면 null로 조용히 넘어간다
export const parsePlayStorePage = (html) => {
  const version = html.match(/\[\[\["([\d.]+)"\]\]/)?.[1] ?? null;
  const ratingRaw = html.match(/"starRating":([\d.]+)/)?.[1];
  const rating = ratingRaw ? round1(Number(ratingRaw)) : null;
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

// 버전이 실제로 높아졌는지 숫자 단위로 비교한다 (스토어 CDN이 옛 버전을 섞어 줘도 뒤로 안 가게)
export const isNewerVersion = (curr, prev) => {
  const a = curr.split('.').map(Number);
  const b = prev.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
};

// CDN 캐시 불일치로 평점이 왔다갔다 관측되는 것을 막는다 — 새 값이 2연속 관측될 때만 확정한다
export const settleObservation = (stored, pending, current) => {
  if (current?.rating == null) {
    return { settled: stored ?? null, nextPending: pending ?? null };
  }
  if (stored?.rating == null) return { settled: current, nextPending: null };
  if (current.rating === stored.rating) {
    return { settled: current, nextPending: null };
  }
  if (pending?.rating === current.rating) {
    return { settled: current, nextPending: null };
  }
  return { settled: stored, nextPending: current };
};

// ASC 심사 상태 전이를 알림 종류로 해석한다. 알림 대상이 아니면 null
export const classifyAscTransition = (prevState, currState) => {
  if (!prevState || prevState === currState) return null;
  if (currState === 'PENDING_DEVELOPER_RELEASE') return 'approved';
  if (currState === 'REJECTED' || currState === 'METADATA_REJECTED')
    return 'rejected';
  return null;
};

// 답글 링크는 콘솔 리뷰 페이지의 정확한 URL이 확보되면 메타 줄에 추가한다
const reviewMeta = (review) => {
  const parts = [review.author, `v${review.version}`];
  if (review.device) parts.push(review.device);
  if (review.osVersion) parts.push(review.osVersion);
  return parts.join(' · ');
};

export const buildReviewEmbed = (store, review) => {
  const title = review.title ? `**${review.title}**\n` : '';
  return {
    author: author(store),
    title: starLine(review.rating),
    description: `${title}${review.body}\n\n${reviewMeta(review)}`,
    color: ratingColor(review.rating),
    timestamp: new Date().toISOString(),
  };
};

export const buildReleaseEmbed = (store, { version, releaseNotes }) => {
  const notes = releaseNotes ? `**릴리즈 노트**\n${releaseNotes}\n\n` : '';
  return {
    author: author(store),
    title: `🚀 랜딧 ${version} 공개됨`,
    description: `${notes}[${STORES[store].name}에서 보기](${STORES[store].url})`,
    color: COLORS.blue,
    timestamp: new Date().toISOString(),
  };
};

export const buildReviewApprovedEmbed = (version) => ({
  author: author('appStore'),
  title: `✅ ${version} 심사 통과 — 출시 대기 중`,
  description: `출시 버튼을 누르면 배포됩니다. [App Store Connect 열기](${ASC_URL})`,
  color: COLORS.purple,
  timestamp: new Date().toISOString(),
});

export const buildReviewRejectedEmbed = (version) => ({
  author: author('appStore'),
  title: `❌ ${version} 심사 거절`,
  description: `사유는 App Store Connect에서 확인하세요. [열기](${ASC_URL})`,
  color: COLORS.red,
  timestamp: new Date().toISOString(),
});

export const buildRatingChangeMessage = (changes, curr) => {
  const line = (store) => {
    const { rating, ratingCount } = curr[store];
    if (rating == null)
      return `${emoji(store)} ${STORES[store].name} 평점 집계 전`;
    const change = changes[store];
    const value = change
      ? `**${change.from} → ${rating}** ${change.direction === 'down' ? '▼' : '▲'} ${round1(
          Math.abs(rating - change.from),
        )}`
      : `**${rating}** 변동 없음`;
    const count = ratingCount != null ? ` · 리뷰 ${ratingCount}개` : '';
    return `${emoji(store)} ${STORES[store].name} ${value}${count}`;
  };

  const hasDown = Object.values(changes).some((c) => c?.direction === 'down');
  return {
    title: '평점 변동이 있어요',
    description: Object.keys(STORES).map(line).join('\n'),
    color: hasDown ? COLORS.orange : COLORS.green,
    timestamp: new Date().toISOString(),
  };
};
