// 서드파티 서비스 상태 감시 — 대상 등록부와 지표 분류·변화 감지·embed 생성
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

export const targetPage = (target) => target.page ?? `https://${target.host}`;

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

export const buildStatusEmbed = (target, change) => {
  const style = LEVEL_STYLE[change.to];
  return {
    author: { name: style.label, icon_url: emojiIcon(style.emojiId) },
    title: target.name,
    url: targetPage(target),
    description: [
      change.description || '상태 페이지를 확인해 주세요.',
      '```',
      `요청: GET ${change.checkUrl ?? targetPage(target)}`,
      `결과: ${change.detail ?? '응답 없음'}`,
      '```',
    ].join('\n'),
    color: style.color,
    timestamp: new Date().toISOString(),
  };
};

const TIMEOUT_MS = 8000;
const UA = 'LanditAlerts/1.0';

const readStatuspage = async (target) => {
  const checkUrl = `https://${target.host}/api/v2/status.json`;
  const res = await fetch(checkUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`상태 조회 실패 ${res.status}`);
  const json = await res.json();
  const indicator = json?.status?.indicator;
  return {
    level: classifyIndicator(indicator),
    description: json?.status?.description ?? '',
    checkUrl,
    detail: `indicator ${indicator ?? '없음'}`,
  };
};

const pingOnce = async (target) => {
  try {
    const res = await fetch(target.url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      level: res.ok ? 'ok' : 'major',
      description: res.ok
        ? '주소가 정상 응답합니다.'
        : '주소가 정상 응답하지 않습니다.',
      checkUrl: target.url,
      detail: `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      level: 'major',
      description: '주소에 닿지 못했습니다.',
      checkUrl: target.url,
      detail: e.message,
    };
  }
};

// 핑 대상은 상태 페이지가 없어 응답 코드가 곧 신호다. 한 번의 실패는 흔들림일 수 있어 마지막 시도로 판정한다
const PING_ATTEMPTS = 2;

const readPing = async (target) => {
  let result;
  for (let attempt = 1; attempt <= PING_ATTEMPTS; attempt += 1) {
    result = await pingOnce(target);
    if (result.level === 'ok') return result;
  }
  return result;
};

export const fetchTargetStatus = async (target) => {
  try {
    const read = target.type === 'statuspage' ? readStatuspage : readPing;
    return { key: target.key, ...(await read(target)) };
  } catch (e) {
    return { key: target.key, level: 'unknown', description: e.message };
  }
};
