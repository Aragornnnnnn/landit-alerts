// 피드백을 보낸 순간의 앰플리튜드 세션 리플레이를 찾는다 — 유저 id → 앰플리튜드 id → 최근 이벤트 중 Feedback Submitted
import { assertOk } from '../shared/http.mjs';

const USER_SEARCH_API = 'https://amplitude.com/api/2/usersearch';
const USER_ACTIVITY_API = 'https://amplitude.com/api/2/useractivity';
const REPLAY_SEARCH_URL =
  'https://app.amplitude.com/analytics/aragorn/session-replay/project/841657/search/replay';

const FEEDBACK_EVENT = 'Feedback Submitted';
// 백엔드 저장 시각과 앱 이벤트 시각의 차이 허용폭 — 이보다 멀면 같은 유저의 다른 피드백이다
const MATCH_WINDOW_MS = 10 * 60 * 1000;
// 피드백 직후라 최근 이벤트 몇십 개 안에 있다
const ACTIVITY_LIMIT = 50;

// 앰플리튜드 event_time은 "2026-10-01 14:26:29.770000" 꼴의 UTC다
const parseEventTime = (eventTime) =>
  Date.parse(`${eventTime.replace(' ', 'T')}Z`);

export const findFeedbackReplay = (events, submittedAtMs) => {
  const match = events.find(
    (e) =>
      e.event_type === FEEDBACK_EVENT &&
      e.session_id > 0 &&
      Math.abs(parseEventTime(e.event_time) - submittedAtMs) <= MATCH_WINDOW_MS,
  );
  if (!match) return null;
  return {
    deviceId: match.device_id,
    sessionId: match.session_id,
    eventTimeMs: parseEventTime(match.event_time),
  };
};

// 리플레이 id는 "기기/세션"이고, 재생 위치는 세션 시작(=session_id)부터 잰다
export const buildReplayUrl = ({ deviceId, sessionId, eventTimeMs }) => {
  const url = new URL(REPLAY_SEARCH_URL);
  url.searchParams.set('sessionReplayId', `${deviceId}/${sessionId}`);
  url.searchParams.set('playerCurrentTime', String(eventTimeMs - sessionId));
  return url.toString();
};

const getJson = async (url, auth, label) =>
  (
    await assertOk(
      await fetch(url, { headers: { Authorization: auth } }),
      label,
    )
  ).json();

export const lookupFeedbackReplay = async ({
  apiKey,
  secretKey,
  userId,
  submittedAtMs,
}) => {
  const auth = `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`;
  const search = await getJson(
    `${USER_SEARCH_API}?user=${encodeURIComponent(userId)}`,
    auth,
    '앰플리튜드 유저 검색',
  );
  const amplitudeId = search.matches?.[0]?.amplitude_id;
  if (!amplitudeId) return null;

  const activity = await getJson(
    `${USER_ACTIVITY_API}?user=${amplitudeId}&limit=${ACTIVITY_LIMIT}&direction=latest`,
    auth,
    '앰플리튜드 유저 활동',
  );
  return findFeedbackReplay(activity.events ?? [], submittedAtMs);
};

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 이벤트가 앰플리튜드에 들어오기까지 수십 초~몇 분 걸린다. 간격마다 다시 보고, 찾으면 바로 멈춘다
export const pollFeedbackReplay = async (
  lookup,
  delaysMs,
  { sleep = sleepMs, log = console.warn } = {},
) => {
  for (const delay of delaysMs) {
    await sleep(delay);
    try {
      const replay = await lookup();
      if (replay) return replay;
    } catch (error) {
      log(`리플레이 조회 실패(다시 시도): ${error.message}`);
    }
  }
  return null;
};
