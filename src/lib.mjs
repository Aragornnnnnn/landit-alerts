// 스토어 알림의 순수 로직 — 피드 파싱, 새 리뷰·릴리즈 감지, 디스코드 embed 생성
export const APP_STORE_ID = '6787414201';
export const PLAY_PACKAGE = 'com.saynow.app';
const ASC_URL = `https://appstoreconnect.apple.com/apps/${APP_STORE_ID}/distribution`;

// 스토어 등록부 — 스토어의 정체성(이름·이모지·링크)은 전부 여기서 나온다
const STORES = {
  appStore: {
    name: 'App Store',
    emojiId: '1535598212247978044',
    url: `https://apps.apple.com/kr/app/id${APP_STORE_ID}`,
  },
  playStore: {
    name: 'Play Store',
    emojiId: '1535598213959000115',
    url: `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`,
  },
};
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
};

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

// 파서는 항상 같은 모양의 객체를 반환하고, 못 찾은 필드만 null이다 (null 반환은 수집 실패 전용)
export const parseAscReviews = (json) =>
  (json?.data ?? []).map((r) => ({
    id: r.id,
    author: r.attributes?.reviewerNickname ?? '익명',
    rating: r.attributes?.rating ?? 0,
    title: r.attributes?.title ?? '',
    body: r.attributes?.body ?? '',
  }));

// 현지화 목록에서 한국어를 우선으로 릴리즈 노트를 고른다
export const parseAscReleaseNotes = (json) => {
  const items = json?.data ?? [];
  const korean = items.find((l) => l.attributes?.locale?.startsWith('ko'));
  return (korean ?? items[0])?.attributes?.whatsNew ?? null;
};

export const parseAscVersion = (json) => {
  const latest = json?.data?.[0];
  return {
    id: latest?.id ?? null,
    version: latest?.attributes?.versionString ?? null,
    state:
      latest?.attributes?.appVersionState ??
      latest?.attributes?.appStoreState ??
      null,
  };
};

// 프로덕션 트랙에서 배포 중(inProgress)을 우선으로 최신 릴리즈를 고른다
export const parsePlayTrack = (json) => {
  const releases = json?.releases ?? [];
  const release =
    releases.find((r) => r.status === 'inProgress') ??
    releases.find((r) => r.status === 'completed') ??
    releases[0];
  const notes = release?.releaseNotes ?? [];
  const korean = notes.find((n) => n.language?.startsWith('ko'));
  return {
    version: release?.name ?? null,
    releaseNotes: (korean ?? notes[0])?.text ?? null,
  };
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

// ASC 심사 상태 전이를 알림 종류로 해석한다. 알림 대상이 아니면 null
export const classifyAscTransition = (prevState, currState) => {
  if (!prevState || prevState === currState) return null;
  if (currState === 'PENDING_DEVELOPER_RELEASE') return 'approved';
  if (currState === 'REJECTED' || currState === 'METADATA_REJECTED')
    return 'rejected';
  return null;
};

// 답글 링크는 콘솔 리뷰 페이지의 정확한 URL이 확보되면 메타 줄에 추가한다
// 작성 버전은 주는 스토어(Play)만 표기한다 — ASC 리뷰엔 없다
const reviewMeta = (review) => {
  const parts = [review.author];
  if (review.version) parts.push(`v${review.version}`);
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
