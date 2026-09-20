// 앰플리튜드 Dashboard REST API 수집기 — 세그멘테이션 응답을 지표 숫자로 옮긴다.
// 표준 조건(팀 계정 제외·모바일만)은 모든 조회에 기본으로 건다. 프로젝트 타임존이 Asia/Seoul이라 날짜는 KST 그대로 넣는다
import { assertOk } from '../shared/http.mjs';

const API = 'https://amplitude.com/api/2/events/segmentation';

// 앰플리튜드는 키 하나당 동시 요청 5개까지다. 넷씩 줄 세우고, 그래도 429면 잠깐 쉬었다 다시 부른다
const MAX_CONCURRENT = 4;
const RETRY_DELAYS_MS = [2000, 5000, 10000];
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

// 줄 서서 호출하고 429는 재시도한다. 그 밖의 실패는 그대로 던진다
export const fetchAmplitude = async (url, headers, label) => {
  await acquire();
  try {
    for (const delay of [0, ...RETRY_DELAYS_MS]) {
      if (delay) await sleep(delay);
      const res = await fetch(url, { headers });
      if (res.status !== 429) return assertOk(res, label);
    }
    throw new Error(`${label} 실패: 재시도 후에도 429`);
  } finally {
    release();
  }
};

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

// 속성이 있는 이벤트만 — 앰플리튜드는 없는 속성을 "(none)"으로 본다
export const hasProp = (key) => ({
  subprop_type: 'event',
  subprop_key: key,
  subprop_op: 'is not',
  subprop_value: ['(none)'],
});

export const propIs = (key, values) => ({
  subprop_type: 'event',
  subprop_key: key,
  subprop_op: 'is',
  subprop_value: values,
});

// --- 응답 → 숫자 (순수) ---

export const singleValue = (data) => data.series?.[0]?.[0] ?? 0;

export const sumSeries = (data) =>
  (data.series ?? []).flat().reduce((a, b) => a + b, 0);

// frequency 라벨("1 time", "2 times", "6-10 times")을 1개 칸부터 채운다. max를 넘는 버킷은 마지막 칸에 합친다
export const countByFrequency = (data, max) => {
  const counts = Array(max).fill(0);
  (data.seriesLabels ?? []).forEach(([, label], i) => {
    const first = Number.parseInt(label, 10);
    if (Number.isNaN(first)) return;
    const slot = Math.min(first, max) - 1;
    counts[slot] += data.series[i].reduce((a, b) => a + b, 0);
  });
  return counts;
};

// frequency 버킷을 앰플리튜드가 준 구간 그대로 [["1개", n], ["6~10개", n], …]로 옮긴다
export const bucketsByFrequency = (data) =>
  (data.seriesLabels ?? []).map(([, label], i) => {
    const [, from, to] = label.match(/^(\d+)(?:-(\d+))?/) ?? [];
    const name = to ? `${from}~${to}개` : `${from}개`;
    return [name, data.series[i].reduce((a, b) => a + b, 0)];
  });

// group_by entry_campaign 응답 → 위젯 유입 수와 알림 캠페인별 유입 수
export const campaignsFromSeries = (data) => {
  const result = { widget: 0, notificationByCampaign: {} };
  (data.seriesLabels ?? []).forEach(([, label], i) => {
    const value = data.series[i].reduce((a, b) => a + b, 0);
    if (label === '(none)') return;
    if (label === 'streak_widget') result.widget = value;
    else result.notificationByCampaign[label] = value;
  });
  return result;
};

// --- 조회 ---

export const createAmplitudeClient = ({ apiKey, secretKey }) => {
  const auth = `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`;

  // start·end는 'YYYYMMDD'. 기간 전체를 한 칸으로 받으려면 i를 기간 일수로 준다
  const query = async ({
    event,
    segment = [],
    start,
    end,
    days = 1,
    ...rest
  }) => {
    const url = new URL(API);
    const params = {
      e: event,
      s: [...STANDARD_SEGMENT, ...segment],
      start,
      end,
      i: String(days),
      ...rest,
    };
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    const res = await fetchAmplitude(
      url,
      { Authorization: auth },
      `앰플리튜드 조회(${event.event_type})`,
    );
    return (await res.json()).data;
  };

  const uniques = async (event, { premium = false, ...range }) =>
    sumSeries(
      await query({
        event,
        m: 'uniques',
        segment: premium ? [PREMIUM_SEGMENT] : [],
        ...range,
      }),
    );

  const totals = async (event, { premium = false, ...range }) =>
    sumSeries(
      await query({
        event,
        m: 'totals',
        segment: premium ? [PREMIUM_SEGMENT] : [],
        ...range,
      }),
    );

  // 유저별 횟수 분포 [1개, 2개, …, max개 이상]
  const frequency = async (event, { premium = false, max, ...range }) =>
    countByFrequency(
      await query({
        event,
        m: 'frequency',
        segment: premium ? [PREMIUM_SEGMENT] : [],
        ...range,
      }),
      max,
    );

  // 이벤트 속성의 평균·최소·최대 (PROPAVG/PROPMIN/PROPMAX)
  const propStat = async (event, prop, fn, { premium = false, ...range }) =>
    singleValue(
      await query({
        event: { ...event, group_by: [{ type: 'event', value: prop }] },
        m: 'formula',
        formula: `${fn}(A)`,
        segment: premium ? [PREMIUM_SEGMENT] : [],
        ...range,
      }),
    );

  const frequencyBuckets = async (event, { premium = false, ...range }) =>
    bucketsByFrequency(
      await query({
        event,
        m: 'frequency',
        segment: premium ? [PREMIUM_SEGMENT] : [],
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

  return {
    query,
    uniques,
    totals,
    frequency,
    frequencyBuckets,
    propStat,
    entries,
  };
};

// --- 리텐션·퍼널 (세그멘테이션과 다른 엔드포인트) ---

const RETENTION_API = 'https://amplitude.com/api/2/retention';
const FUNNEL_API = 'https://amplitude.com/api/2/funnels';

export const createAmplitudeExtras = ({ apiKey, secretKey }) => {
  const auth = `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`;
  const headers = { Authorization: auth };

  // 가입(Onboarding Completed) 코호트가 다음 칸(하루 뒤 / 한 주 뒤)에 돌아온 수.
  // 응답 values[코호트][2]가 첫 번째 다음 칸이다 — [0]·[1]은 코호트 크기 행
  const retention = async ({ cohortStart, days }) => {
    const url = new URL(RETENTION_API);
    url.searchParams.set(
      'se',
      JSON.stringify({ event_type: 'Onboarding Completed' }),
    );
    url.searchParams.set('re', JSON.stringify({ event_type: '_active' }));
    url.searchParams.set('s', JSON.stringify(STANDARD_SEGMENT));
    url.searchParams.set('start', cohortStart);
    url.searchParams.set('end', cohortStart);
    url.searchParams.set('i', String(days));
    const res = await fetchAmplitude(url, headers, '앰플리튜드 리텐션 조회');
    const { series } = (await res.json()).data;
    const rows = Object.values(series?.[0]?.values ?? {})[0] ?? [];
    return { cohort: rows[0]?.outof ?? 0, returned: rows[2]?.count ?? 0 };
  };

  // 두 이벤트를 순서대로 한 사람 수 [첫 단계, 둘째 단계]
  const funnel = async (events, { start, end, windowDays }) => {
    const url = new URL(FUNNEL_API);
    for (const event of events)
      url.searchParams.append('e', JSON.stringify({ event_type: event }));
    url.searchParams.set('s', JSON.stringify(STANDARD_SEGMENT));
    url.searchParams.set('start', start);
    url.searchParams.set('end', end);
    url.searchParams.set('cs', String(windowDays * 86400));
    const res = await fetchAmplitude(url, headers, '앰플리튜드 퍼널 조회');
    return (await res.json()).data[0].cumulativeRaw;
  };

  return { retention, funnel };
};
