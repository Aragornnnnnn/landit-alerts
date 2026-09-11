// Sentry 알림의 순수 로직 — 웹훅 서명 검증, payload 해석, 이슈 카드 embed 생성
import { createHmac, timingSafeEqual } from 'node:crypto';

// 디스코드 상한 — 넘으면 메시지 전체가 거절된다
const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4096;
const MAX_FIELD_LENGTH = 1024;

const LEVEL_STYLE = {
  fatal: { emoji: '🔴', color: 0xe74c3c },
  error: { emoji: '🔴', color: 0xe74c3c },
  warning: { emoji: '🟡', color: 0xf1c40f },
  info: { emoji: '🔵', color: 0x3498db },
  debug: { emoji: '🔵', color: 0x3498db },
};

const safeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length)
    return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

const hmac = (secret, body) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex');

// Sentry는 body를 자기가 다시 직렬화한 문자열로 서명한다 — raw body가 어긋나면 그 형태로 한 번 더 본다
export const isValidSentrySignature = (secret, rawBody, signature) => {
  if (!secret || !signature) return false;
  if (safeEqualHex(hmac(secret, rawBody), signature)) return true;
  try {
    return safeEqualHex(
      hmac(secret, JSON.stringify(JSON.parse(rawBody))),
      signature,
    );
  } catch {
    return false;
  }
};

// 이슈 알림(event_alert)만 다룬다. 설치·이슈 상태 변경 같은 다른 리소스는 null
export const parseSentryWebhook = (resource, payload) =>
  resource === 'event_alert' && payload?.data?.event
    ? { event: payload.data.event, rule: payload.data.triggered_rule }
    : null;

// SENTRY_CHANNELS = {"<프로젝트 id>": "<디스코드 웹훅 URL>"} — 프로젝트마다 채널을 나눈다
export const resolveSentryChannel = (channelsJson, projectId) => {
  if (!channelsJson) return null;
  return JSON.parse(channelsJson)[String(projectId)] ?? null;
};

const tagValue = (tags, key) =>
  (tags ?? []).find(([k]) => k === key)?.[1] ?? null;

const userLabel = (user) => user?.email ?? user?.id ?? null;

const field = (name, value, inline = true) =>
  value
    ? { name, value: String(value).slice(0, MAX_FIELD_LENGTH), inline }
    : null;

export const buildSentryEmbed = (event, rule) => {
  const { emoji, color } = LEVEL_STYLE[event.level] ?? LEVEL_STYLE.error;
  const fields = [
    field('환경', event.environment),
    field('릴리즈', event.release),
    field('사용자', userLabel(event.user)),
    field('브라우저', tagValue(event.tags, 'browser')),
    field('OS', tagValue(event.tags, 'os')),
    field('URL', tagValue(event.tags, 'url'), false),
  ].filter(Boolean);
  return {
    title: `${emoji} ${event.title}`.slice(0, MAX_TITLE_LENGTH),
    url: event.web_url,
    description: (event.culprit ?? '').slice(0, MAX_DESCRIPTION_LENGTH),
    color,
    fields,
    footer: { text: `규칙 · ${rule}` },
    timestamp: new Date(event.timestamp * 1000).toISOString(),
  };
};
