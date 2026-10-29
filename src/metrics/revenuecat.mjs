// RevenueCat v2 수집기 — 구독 중 인원을 연간·월간(결제한 사람)으로 가르고 누적 매출을 읽는다.
// 프로모션은 세지 않는다 — 100일 이용권이 프로모션 권한으로 붙어 100일 줄과 같은 사람이 겹친다
import { assertOk } from '../shared/http.mjs';

const API = 'https://api.revenuecat.com/v2/projects';
const RETRY_DELAYS_MS = [3000, 15000, 60000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const planOf = (label) => {
  const lower = label.toLowerCase();
  if (lower.includes('yearly')) return 'yearly';
  if (lower.includes('monthly')) return 'monthly';
  return null;
};

// 누적 매출을 셀 시작일 — 첫 결제(2026-07)보다 앞이면 된다
const REVENUE_SINCE = '2026-01-01';

// 매출 차트 응답의 기간 합계(원 단위 반올림). 원화가 아니면 숫자를 믿을 수 없어 던진다
export const totalRevenue = (chart) => {
  if (chart.yaxis_currency !== 'KRW')
    throw new Error(
      `RevenueCat 매출 통화가 원화가 아님(${chart.yaxis_currency})`,
    );
  return Math.round(chart.summary?.total?.Revenue ?? 0);
};

// 차트 값 중 해당 날짜(UTC 자정 epoch)의 값을 세그먼트 이름별로
export const valuesAt = (chart, isoDate) => {
  const cohort = Date.parse(`${isoDate}T00:00:00Z`) / 1000;
  const names = chart.segments?.length
    ? chart.segments.map((s) => s.display_name)
    : ['Total'];
  const result = {};
  for (const row of chart.values ?? []) {
    if (row.cohort !== cohort) continue;
    result[names[row.segment ?? 0]] = row.value;
  }
  return result;
};

export const createRevenueCatClient = ({ apiKey, projectId }) => {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const base = `${API}/${projectId}`;

  // 한도에 걸리면 RevenueCat이 알려 준 만큼 쉬었다 다시 부른다
  const getJson = async (url, label) => {
    for (const [attempt, delay] of [0, ...RETRY_DELAYS_MS].entries()) {
      if (delay) await sleep(delay);
      const res = await fetch(url, { headers });
      if (res.status !== 429) return (await assertOk(res, label)).json();
      if (attempt === RETRY_DELAYS_MS.length) break;
      const retryAfter = Number(res.headers.get('retry-after'));
      if (retryAfter > 0) await sleep(retryAfter * 1000);
    }
    throw new Error(`${label} 실패: 재시도 후에도 429`);
  };

  const chart = async (name, { date, segment }) => {
    const url = new URL(`${base}/charts/${name}`);
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    url.searchParams.set('resolution', '0');
    if (segment) url.searchParams.set('segment', segment);
    const values = valuesAt(
      await getJson(url, `RevenueCat 차트(${name})`),
      date,
    );
    // 집계가 아직 안 된 날이면 빈 객체가 온다 — 0명으로 조용히 내보내지 않는다
    if (!Object.keys(values).length)
      throw new Error(`RevenueCat 차트(${name}) ${date} 값 없음`);
    return values;
  };

  // 그날 끝 기준 구독 중 인원
  const subscriptions = async (date) => {
    const actives = await chart('actives', { date, segment: 'product_id' });
    const byPlan = (values) => {
      const out = { monthly: 0, yearly: 0 };
      for (const [label, value] of Object.entries(values)) {
        const plan = planOf(label);
        if (plan) out[plan] += value;
      }
      return out;
    };
    // actives는 결제 중인 구독만 센다 — 무료체험은 trials 차트에 따로 있어 여기 안 들어간다
    return byPlan(actives);
  };

  // 서비스 시작부터 그날까지 매출 합계(원). 레비뉴캣이 원화로 환산해 준다.
  // 스토어 수수료를 떼기 전, 환불은 뺀 값이다. 이용권 같은 단건 결제도 들어간다
  const revenue = async (date) => {
    const url = new URL(`${base}/charts/revenue`);
    url.searchParams.set('start_date', REVENUE_SINCE);
    url.searchParams.set('end_date', date);
    url.searchParams.set('resolution', '3'); // 분기 — 합계만 쓰므로 칸 수를 줄인다
    url.searchParams.set('currency', 'KRW');
    return totalRevenue(await getJson(url, 'RevenueCat 차트(revenue)'));
  };

  return { subscriptions, revenue };
};
