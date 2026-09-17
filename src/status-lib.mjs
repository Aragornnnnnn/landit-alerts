// 서드파티 상태 알림의 순수 로직 — 감시 대상 등록부, 지표 분류, 변화 감지, 카드 생성
const COLORS = {
  green: 0x57f287,
  yellow: 0xfee75c,
  red: 0xed4245,
};

// 감시 대상 등록부 — statuspage는 공개 상태 API를, ping은 서비스 주소 응답을 본다
export const TARGETS = [
  {
    key: 'vercel',
    name: 'Vercel',
    type: 'statuspage',
    host: 'www.vercel-status.com',
  },
  {
    key: 'supabase',
    name: 'Supabase',
    type: 'statuspage',
    host: 'status.supabase.com',
  },
  {
    key: 'revenuecat',
    name: 'RevenueCat',
    type: 'statuspage',
    host: 'status.revenuecat.com',
  },
  {
    key: 'sentry',
    name: 'Sentry',
    type: 'statuspage',
    host: 'status.sentry.io',
  },
  {
    key: 'amplitude',
    name: 'Amplitude',
    type: 'statuspage',
    host: 'status.amplitude.com',
  },
  {
    key: 'deepgram',
    name: 'Deepgram',
    type: 'statuspage',
    host: 'status.deepgram.com',
  },
  { key: 'expo', name: 'Expo', type: 'statuspage', host: 'status.expo.dev' },
  {
    key: 'github',
    name: 'GitHub',
    type: 'statuspage',
    host: 'www.githubstatus.com',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    type: 'ping',
    url: 'https://openrouter.ai/api/v1/models',
    page: 'https://status.openrouter.ai',
  },
  {
    key: 'kakao',
    name: '카카오 로그인',
    type: 'ping',
    url: 'https://kauth.kakao.com/.well-known/openid-configuration',
    page: 'https://developers.kakao.com',
  },
];

const targetPage = (target) => target.page ?? `https://${target.host}`;

// Statuspage 지표는 네 가지지만 우리한테 major와 critical은 같은 뜻이다
export const classifyIndicator = (indicator) => {
  if (indicator === 'none') return 'ok';
  if (indicator === 'minor') return 'minor';
  if (indicator === 'major' || indicator === 'critical') return 'major';
  return 'unknown';
};

// 못 읽은 대상(unknown)은 판단을 미룬다 — 우리 쪽 실패를 장애로 알리지 않기 위해서다
export const diffStatusChanges = (previous, current) =>
  current
    .filter((entry) => entry.level !== 'unknown')
    .map((entry) => ({
      ...entry,
      from: previous[entry.key] ?? 'ok',
      to: entry.level,
    }))
    .filter((change) => change.from !== change.to);

export const nextLevels = (previous, current) => {
  const levels = { ...previous };
  for (const entry of current) {
    if (entry.level !== 'unknown') levels[entry.key] = entry.level;
  }
  return levels;
};

// 아이콘은 디스코드 앱 이모지(토스페이스)의 CDN 주소를 쓴다. scripts/upload-app-emoji.mjs 참고
const emojiIcon = (id) => `https://cdn.discordapp.com/emojis/${id}.png`;

const LEVEL_STYLE = {
  ok: {
    color: COLORS.green,
    label: '정상 복구',
    emojiId: '1550045144571576351',
  },
  minor: {
    color: COLORS.yellow,
    label: '일부 장애',
    emojiId: '1550045150267441213',
  },
  major: { color: COLORS.red, label: '장애', emojiId: '1550045143132798976' },
};

// 무엇을 근거로 이렇게 판정했는지 카드에 그대로 남긴다
const checkRecord = (target, change) =>
  [
    '```',
    `요청: GET ${change.checkUrl ?? targetPage(target)}`,
    `결과: ${change.response ?? '응답 없음'}`,
    '```',
  ].join('\n');

export const buildStatusEmbed = (target, change, now = new Date()) => {
  const style = LEVEL_STYLE[change.to];
  return {
    author: { name: style.label, icon_url: emojiIcon(style.emojiId) },
    title: target.name,
    url: targetPage(target),
    description: `${change.description || '상태 페이지를 확인해 주세요.'}\n${checkRecord(target, change)}`,
    color: style.color,
    timestamp: now.toISOString(),
  };
};
