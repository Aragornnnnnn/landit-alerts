// Sentry 알림의 순수 로직 — 웹훅 서명 검증, payload 해석, 이슈 카드 embed 생성
import { createHmac, timingSafeEqual } from 'node:crypto';

// 디스코드 상한 — 넘으면 메시지 전체가 거절된다
const MAX_TITLE_LENGTH = 256;
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
    ? { event: payload.data.event }
    : null;

// SENTRY_CHANNELS = {"<프로젝트 id>": "<디스코드 웹훅 URL>"} — 프로젝트마다 채널을 나눈다
export const resolveSentryChannel = (channelsJson, projectId) => {
  if (!channelsJson) return null;
  return JSON.parse(channelsJson)[String(projectId)] ?? null;
};

const tagValue = (tags, key) =>
  (tags ?? []).find(([k]) => k === key)?.[1] ?? null;

// 사용자는 id만 — 이메일은 디스코드에 남길 정보가 아니고, 조회는 id로 한다
const userLabel = (user) => user?.id ?? null;

// 기기는 contexts.device.model이 정확하고, 없으면 device 태그로 대신한다
const deviceLabel = (event) =>
  event.contexts?.device?.model ?? tagValue(event.tags, 'device');

// 앱 버전은 모바일(contexts.app)에만 있다. 웹은 릴리즈로 충분하다
const appVersionLabel = (event) => {
  const app = event.contexts?.app;
  if (!app?.app_version) return null;
  return app.app_build
    ? `${app.app_version} (${app.app_build})`
    : app.app_version;
};

// 요청은 "GET https://…" 한 줄. request가 없으면 url 태그로 대신한다
const requestLabel = (event) => {
  const url = event.request?.url ?? tagValue(event.tags, 'url');
  if (!url) return null;
  const method = event.request?.method;
  return method ? `${method} ${url}` : url;
};

const firstException = (event) => event.exception?.values?.[0] ?? null;

// 예외 타입과 메시지 — 제목이 이미 "타입: 메시지"면 중복이라 생략한다
const exceptionLabel = (event) => {
  const ex = firstException(event);
  if (!ex?.type) return null;
  const label = ex.value ? `${ex.type}: ${ex.value}` : ex.type;
  return event.title === label ? null : label;
};

// 스택은 앱 코드 프레임을 최근 순으로 최대 3개, 없으면 전체에서 3개
const MAX_FRAMES = 3;
const stackLabel = (event) => {
  const frames = firstException(event)?.stacktrace?.frames ?? [];
  const inApp = frames.filter((f) => f.in_app);
  const picked = (inApp.length ? inApp : frames).slice(-MAX_FRAMES).reverse();
  if (!picked.length) return null;
  const lines = picked.map((f) => {
    const where = f.filename ?? f.abs_path ?? f.module ?? '?';
    const line = f.lineno ? `:${f.lineno}` : '';
    return `${f.function ?? '?'}  ${where}${line}`;
  });
  return '```\n' + lines.join('\n') + '\n```';
};

const field = (name, value, inline = true) =>
  value
    ? { name, value: String(value).slice(0, MAX_FIELD_LENGTH), inline }
    : null;

export const buildSentryEmbed = (event) => {
  const { emoji, color } = LEVEL_STYLE[event.level] ?? LEVEL_STYLE.error;
  const stack = stackLabel(event);
  const fields = [
    field('환경', event.environment),
    field('릴리즈', event.release),
    field('앱 버전', appVersionLabel(event)),
    field('사용자', userLabel(event.user)),
    field('브라우저', tagValue(event.tags, 'browser')),
    field('OS', tagValue(event.tags, 'os')),
    field('기기', deviceLabel(event)),
    field('예외', exceptionLabel(event), false),
    field('요청', requestLabel(event), false),
    // culprit(파일 in 함수)은 스택 첫 줄과 겹치므로 스택이 없을 때만 보여준다
    field('발생 위치', stack ? null : event.culprit, false),
    field('호출 경로 (맨 위가 터진 곳)', stack, false),
  ].filter(Boolean);
  return {
    title: `${emoji} ${event.title}`.slice(0, MAX_TITLE_LENGTH),
    url: event.web_url,
    color,
    fields,
    timestamp: new Date(event.timestamp * 1000).toISOString(),
  };
};
