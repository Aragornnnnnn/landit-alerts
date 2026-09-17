// 서드파티 서비스 상태 수집기 — 상태 페이지 API를 읽거나 서비스 주소를 직접 찔러 본다
import { classifyIndicator } from './status-lib.mjs';

const TIMEOUT_MS = 8000;
const UA = 'LanditAlerts/1.0';
// 핑은 한 번의 실패가 흔들림일 수 있어 마지막 시도로 판정한다
const PING_ATTEMPTS = 2;

// 우리가 실제로 찔러 보는 주소 — 카드에서 사람에게 보여 주는 상태 페이지 주소와 다르다
const checkUrlOf = (target) =>
  target.type === 'statuspage'
    ? `https://${target.host}/api/v2/status.json`
    : target.url;

const readStatuspage = async (target) => {
  const checkUrl = checkUrlOf(target);
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
    response: `indicator ${indicator ?? '없음'}`,
  };
};

const pingOnce = async (target) => {
  const checkUrl = checkUrlOf(target);
  try {
    const res = await fetch(checkUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return {
      level: res.ok ? 'ok' : 'major',
      description: res.ok
        ? '주소가 정상 응답합니다.'
        : '주소가 정상 응답하지 않습니다.',
      checkUrl,
      response: `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      level: 'major',
      description: '주소에 닿지 못했습니다.',
      checkUrl,
      response: e.message,
    };
  }
};

// 핑 대상은 상태 페이지가 없어 응답 코드가 곧 신호다
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
    return {
      key: target.key,
      level: 'unknown',
      description: '상태를 읽지 못했습니다.',
      checkUrl: checkUrlOf(target),
      response: e.message,
    };
  }
};
