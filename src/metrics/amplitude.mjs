// 앰플리튜드 Dashboard REST API 수집기 — 세그멘테이션·리텐션·퍼널 응답을 지표 숫자로 옮긴다.
// 표준 조건(팀 계정 제외·모바일만)은 모든 조회에 기본으로 건다. 프로젝트 타임존이 Asia/Seoul이라 날짜는 KST 그대로 넣는다
import { assertOk } from '../shared/http.mjs';

const SEGMENTATION_API = 'https://amplitude.com/api/2/events/segmentation';
const RETENTION_API = 'https://amplitude.com/api/2/retention';
const FUNNEL_API = 'https://amplitude.com/api/2/funnels';

// 앰플리튜드는 키 하나당 동시 요청 5개까지다. 넷씩 줄 세우고, 일시적인 실패는 쉬었다 다시 부른다.
// 5분당 비용 한도에도 걸릴 수 있어 마지막 대기는 그 창을 넘길 만큼 길게 잡는다
const MAX_CONCURRENT = 4;
const RETRY_DELAYS_MS = [3000, 15000, 60000, 180000];
let running = 0;
const waiting = [];
const acquire = () =>
  new Promise((resolve) => {
    if (running < MAX_CONCURRENT) {
      running += 1;
      resolve();
    } else waiting.push(resolve);
  });
const release = () => {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 한도 초과(429)와 앰플리튜드 쪽 일시 장애(5xx)·네트워크 끊김만 다시 부른다. 그 밖의 실패는 그대로 던진다
const isTransient = (status) => status === 429 || status >= 500;

const fetchWithRetry = async (url, headers, label) => {
  await acquire();
  try {
    let lastReason = '';
    for (const [attempt, delay] of [0, ...RETRY_DELAYS_MS].entries()) {
      if (delay) await sleep(delay);
      try {
        const res = await fetch(url, { headers });
        if (!isTransient(res.status)) return assertOk(res, label);
        lastReason = `응답 ${res.status}`;
      } catch (error) {
        // 네트워크 자체가 끊긴 경우 — 마지막 시도였다면 아래에서 함께 보고한다
        lastReason = error.message;
        if (attempt === RETRY_DELAYS_MS.length) throw error;
      }
    }
    throw new Error(`${label} 실패: 재시도 후에도 ${lastReason}`);
  } finally {
    release();
  }
};

// --- 이벤트 속성 필터 ---

// 앰플리튜드는 속성이 없는 이벤트를 "(none)"으로 본다 — 속성이 있는 것만 고를 때 쓴다
const NONE = '(none)';

export const hasProp = (key) => ({
  subprop_type: 'event',
  subprop_key: key,
  subprop_op: 'is not',
  subprop_value: [NONE],
});

export const propIsNot = (key, values) => ({
  subprop_type: 'event',
  subprop_key: key,
  subprop_op: 'is not',
  subprop_value: [NONE, ...values],
});

// --- 응답 → 숫자 (순수) ---

export const singleValue = (data) => data.series?.[0]?.[0] ?? 0;

export const sumSeries = (data) =>
  (data.series ?? []).flat().reduce((a, b) => a + b, 0);

const bucketTotal = (data, index) =>
  data.series[index].reduce((a, b) => a + b, 0);

// frequency 라벨("1 time", "6-10 times")을 1개 칸부터 채운다. max를 넘는 버킷은 마지막 칸에 합친다
export const countByFrequency = (data, max) => {
  const counts = Array(max).fill(0);
  (data.seriesLabels ?? []).forEach(([, label], i) => {
    const first = Number.parseInt(label, 10);
    if (Number.isNaN(first)) return;
    counts[Math.min(first, max) - 1] += bucketTotal(data, i);
  });
  return counts;
};

// frequency 버킷을 앰플리튜드가 준 구간 그대로 [["1개", n], ["6~10개", n], …]로 옮긴다
export const bucketsByFrequency = (data) =>
  (data.seriesLabels ?? [])
    .map(([, label], i) => {
      const match = String(label).match(/^(\d+)(?:-(\d+))?/);
      if (!match) return null;
      const [, from, to] = match;
      return [to ? `${from}~${to}개` : `${from}개`, bucketTotal(data, i)];
    })
    .filter(Boolean);

// group_by entry_campaign 응답 → 위젯 유입 수와 알림 캠페인별 유입 수.
// 캠페인별 수는 사람이 겹칠 수 있어 합계로 쓰지 않는다 (알림 전체 인원은 따로 조회한다)
export const campaignsFromSeries = (data) => {
  const result = { widget: 0, notificationByCampaign: {} };
  (data.seriesLabels ?? []).forEach(([, label], i) => {
    if (label === NONE) return;
    const value = bucketTotal(data, i);
    if (label === WIDGET_CAMPAIGN) result.widget = value;
    else result.notificationByCampaign[label] = value;
  });
  return result;
};

// 위젯 탭 유입 캠페인 — 나머지 캠페인은 전부 알림이다 (어휘는 landit-fe docs/analytics-utm.md)
export const WIDGET_CAMPAIGN = 'streak_widget';

// --- 조회 ---

// 랜딧 팀이 테스트로 남긴 계정 — landit-fe .claude/skills/amplitude/SKILL.md 표준 조건과 같다
const TEAM_USER_IDS =
  '1 2 3 4 5 7 11 12 34 35 36 37 38 39 172 297 327 465 467 470 476 477 480 509'.split(
    ' ',
  );

const STANDARD_SEGMENT = [
  { prop: 'user_id', op: 'is not', values: TEAM_USER_IDS },
  { prop: 'gp:platform', op: 'is', values: ['ios', 'android'] },
];
// REST에선 커스텀 유저 속성에 gp: 접두사가 붙는다 (is_premium 그대로는 400)
const PREMIUM_SEGMENT = { prop: 'gp:is_premium', op: 'is', values: ['true'] };

export const createAmplitudeClient = ({ apiKey, secretKey }) => {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`,
  };

  const request = async (api, params, label) => {
    const url = new URL(api);
    for (const [key, value] of Object.entries(params))
      for (const one of Array.isArray(value) && key === 'e' ? value : [value])
        url.searchParams.append(
          key,
          typeof one === 'string' ? one : JSON.stringify(one),
        );
    const res = await fetchWithRetry(url, headers, label);
    return (await res.json()).data;
  };

  // start·end는 'YYYYMMDD'. 기간 전체를 한 칸으로 받으려면 days에 기간 일수를 준다
  const query = ({ event, premium = false, start, end, days = 1, ...rest }) =>
    request(
      SEGMENTATION_API,
      {
        e: event,
        s: [...STANDARD_SEGMENT, ...(premium ? [PREMIUM_SEGMENT] : [])],
        start,
        end,
        i: String(days),
        ...rest,
      },
      `앰플리튜드 조회(${event.event_type})`,
    );

  const uniques = async (event, range) =>
    sumSeries(await query({ event, m: 'uniques', ...range }));

  const totals = async (event, range) =>
    sumSeries(await query({ event, m: 'totals', ...range }));

  // 유저별 횟수 분포 [1개, 2개, …, max개 이상]
  const frequency = async (event, { max, ...range }) =>
    countByFrequency(await query({ event, m: 'frequency', ...range }), max);

  // 유저별 횟수 분포를 앰플리튜드 버킷 그대로
  const frequencyBuckets = async (event, range) =>
    bucketsByFrequency(await query({ event, m: 'frequency', ...range }));

  // 이벤트 속성의 평균·최소·최대 (PROPAVG/PROPMIN/PROPMAX)
  const propStat = async (event, prop, fn, range) =>
    singleValue(
      await query({
        event: { ...event, group_by: [{ type: 'event', value: prop }] },
        m: 'formula',
        formula: `${fn}(A)`,
        ...range,
      }),
    );

  const entries = async (range) =>
    campaignsFromSeries(
      await query({
        event: {
          event_type: 'Page Viewed',
          group_by: [{ type: 'event', value: 'entry_campaign' }],
        },
        m: 'uniques',
        ...range,
      }),
    );

  // 가입(Onboarding Completed) 코호트가 다음 칸(하루 뒤 / 한 주 뒤)에 돌아온 수.
  // 응답 values[코호트][2]가 첫 번째 다음 칸이다 — [0]·[1]은 코호트 크기 행
  const retention = async ({ cohortStart, days }) => {
    const { series } = await request(
      RETENTION_API,
      {
        se: { event_type: 'Onboarding Completed' },
        re: { event_type: '_active' },
        s: STANDARD_SEGMENT,
        start: cohortStart,
        end: cohortStart,
        i: String(days),
      },
      '앰플리튜드 리텐션 조회',
    );
    const rows = Object.values(series?.[0]?.values ?? {})[0] ?? [];
    return { cohort: rows[0]?.outof ?? 0, returned: rows[2]?.count ?? 0 };
  };

  // 두 이벤트를 순서대로 한 사람 수 [첫 단계, 둘째 단계]
  const funnel = async (events, { start, end, windowDays }) => {
    const data = await request(
      FUNNEL_API,
      {
        e: events.map((event_type) => ({ event_type })),
        s: STANDARD_SEGMENT,
        start,
        end,
        cs: String(windowDays * 86400),
      },
      `앰플리튜드 퍼널 조회(${events.join(' → ')})`,
    );
    return data[0].cumulativeRaw;
  };

  return {
    query,
    uniques,
    totals,
    frequency,
    frequencyBuckets,
    propStat,
    entries,
    retention,
    funnel,
  };
};
