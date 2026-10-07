// 피드백을 보낸 순간의 앰플리튜드 리플레이 찾기 테스트
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  buildReplayUrl,
  findFeedbackReplay,
  lookupFeedbackReplay,
  pollFeedbackReplay,
} from './replay.mjs';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// 2026-10-01 23:26:30 KST
const SUBMITTED_AT = Date.parse('2026-10-01T14:26:30Z');

const event = (overrides) => ({
  event_type: 'Feedback Submitted',
  event_time: '2026-10-01 14:26:29.770000',
  device_id: 'd428814b',
  session_id: 1790863979554,
  ...overrides,
});

test('피드백 시각 근처의 Feedback Submitted 이벤트에서 기기·세션을 꺼낸다', () => {
  // Given 다른 이벤트 사이에 피드백 제출 이벤트가 있다
  const events = [event({ event_type: 'Page Viewed' }), event()];

  // When 리플레이를 찾으면
  const replay = findFeedbackReplay(events, SUBMITTED_AT);

  // Then 그 이벤트의 기기·세션·발생 시각을 돌려준다
  assert.deepEqual(replay, {
    deviceId: 'd428814b',
    sessionId: 1790863979554,
    eventTimeMs: Date.parse('2026-10-01T14:26:29.770Z'),
  });
});

test('10분 넘게 떨어진 제출 이벤트는 다른 피드백으로 보고 고르지 않는다', () => {
  const earlier = event({ event_time: '2026-10-01 14:10:00.000000' });

  assert.equal(findFeedbackReplay([earlier], SUBMITTED_AT), null);
});

test('세션이 없는 이벤트(session_id -1)는 리플레이가 없다', () => {
  assert.equal(
    findFeedbackReplay([event({ session_id: -1 })], SUBMITTED_AT),
    null,
  );
});

test('리플레이 주소는 제출한 순간부터 재생되게 세션 시작 기준 오프셋을 붙인다', () => {
  const url = buildReplayUrl({
    deviceId: 'd428814b',
    sessionId: 1790863979554,
    eventTimeMs: 1790864789770,
  });

  assert.equal(
    url,
    'https://app.amplitude.com/analytics/aragorn/session-replay/project/841657/search/replay?sessionReplayId=d428814b%2F1790863979554&playerCurrentTime=810216',
  );
});

test('유저 id로 앰플리튜드 id를 찾고, 그 유저의 최근 이벤트에서 리플레이를 고른다', async () => {
  // Given 유저 검색과 활동 조회에 응답하는 앰플리튜드
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (url.includes('/usersearch'))
      return Response.json({ matches: [{ amplitude_id: 1714729123870 }] });
    return Response.json({ events: [event()] });
  };

  // When 피드백 보낸 사람으로 조회하면
  const replay = await lookupFeedbackReplay({
    apiKey: 'k',
    secretKey: 's',
    userId: 1429,
    submittedAtMs: SUBMITTED_AT,
  });

  // Then 두 API를 차례로 부르고 리플레이를 돌려준다
  assert.equal(
    calls[0].url,
    'https://amplitude.com/api/2/usersearch?user=1429',
  );
  assert.match(calls[1].url, /useractivity\?user=1714729123870&/);
  assert.equal(calls[0].auth, `Basic ${Buffer.from('k:s').toString('base64')}`);
  assert.equal(replay.sessionId, 1790863979554);
});

test('앰플리튜드에 아직 그 유저가 없으면 null', async () => {
  globalThis.fetch = async () => Response.json({ matches: [] });

  const replay = await lookupFeedbackReplay({
    apiKey: 'k',
    secretKey: 's',
    userId: 1429,
    submittedAtMs: SUBMITTED_AT,
  });

  assert.equal(replay, null);
});

test('찾을 때까지 정해 둔 간격으로 다시 보고, 중간 실패는 넘긴다', async () => {
  // Given 처음엔 실패, 다음엔 아직 없음, 세 번째에 찾는 조회
  const results = [
    () => {
      throw new Error('429');
    },
    () => null,
    () => ({ sessionId: 1 }),
  ];
  const waited = [];

  // When 간격을 두고 찾으면
  const replay = await pollFeedbackReplay(
    () => results.shift()(),
    [10, 20, 30, 40],
    {
      sleep: async (ms) => waited.push(ms),
      log: () => {},
    },
  );

  // Then 세 번째에서 멈춘다
  assert.deepEqual(replay, { sessionId: 1 });
  assert.deepEqual(waited, [10, 20, 30]);
});

test('끝까지 못 찾으면 null', async () => {
  const replay = await pollFeedbackReplay(async () => null, [1, 2], {
    sleep: async () => {},
    log: () => {},
  });

  assert.equal(replay, null);
});
