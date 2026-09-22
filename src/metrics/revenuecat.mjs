// RevenueCat v2 수집기 — 구독 중 인원을 월간·연간(무료체험/결제)·프로모션으로 가른다.
// 유료·체험은 상품별 차트에서, 프로모션은 차트에 안 잡혀 고객 전수 조회로 그날 끝 기준으로 센다
import { assertOk } from '../shared/http.mjs';

const API = 'https://api.revenuecat.com/v2/projects';
// 고객 정보 조회는 분당 한도가 있다 — 워커 다섯이 이 간격을 지키면 초당 8건을 넘지 않는다
const CUSTOMER_WORKERS = 5;
const CUSTOMER_GAP_MS = 125;
const RETRY_DELAYS_MS = [3000, 15000, 60000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const planOf = (label) => {
  const lower = label.toLowerCase();
  if (lower.includes('yearly')) return 'yearly';
  if (lower.includes('monthly')) return 'monthly';
  return null;
};

const kstDayEndMs = (isoDate) =>
  new Date(`${isoDate}T23:59:59.999+09:00`).getTime();

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

// 그 시각에 아직 살아 있던 프로덕션 구독인가
const aliveAt = (sub, at) => {
  if (sub.environment !== 'production') return false;
  const end = sub.ends_at ?? sub.current_period_ends_at;
  return sub.starts_at <= at && (end == null || end > at);
};

// 그날 끝(KST)에 살아 있던 프로모션 구독 수. 샌드박스는 뺀다
export const promoAt = (subscriptions, isoDate) => {
  const at = kstDayEndMs(isoDate);
  return subscriptions.filter(
    (sub) => sub.store === 'promotional' && aliveAt(sub, at),
  ).length;
};

// 그날 끝에 아직 쓸 수 있지만 다음 결제를 끄둔 구독 수 — 체험 중 해지도 여기 들어간다.
// 프로모션은 원래 갱신이 없어 제외한다. 구독 기록의 상품 번호가 레비뉴캣 내부 id(prod…)라
// 월간·연간을 가를 수 없다 — 지금은 스토어 구독이 연간뿐이라 연간 아래에 붙인다
export const cancelingAt = (subscriptions, isoDate) => {
  const at = kstDayEndMs(isoDate);
  return subscriptions.filter(
    (sub) =>
      sub.store !== 'promotional' &&
      sub.auto_renewal_status === 'will_not_renew' &&
      aliveAt(sub, at),
  ).length;
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

  // 고객 전부의 구독을 한 번만 긁어 둔다. 프로미스를 담아야 동시에 불러도 한 번만 돈다
  let scanning;
  const scanSubscriptions = () => (scanning ??= scanAll());

  const scanAll = async () => {
    const queue = [];
    const found = [];
    let listing = true;

    // 목록이 실패해도 listing을 반드시 내려야 워커가 멈춘다
    const listAll = async () => {
      try {
        let url = `${base}/customers?limit=100`;
        while (url) {
          const page = await getJson(url, 'RevenueCat 고객 목록');
          queue.push(...page.items);
          url = page.next_page && new URL(page.next_page, base).href;
        }
      } finally {
        listing = false;
      }
    };

    // 목록을 넘기는 동안 워커가 먼저 출발한다 — 페이지가 많아도 대기가 겹치지 않게
    // 구독 조회가 실패하면 워커가 멈추고, 남은 워커도 목록이 끝나는 대로 빠져나온다
    const worker = async () => {
      while (listing || queue.length) {
        const customer = queue.shift();
        if (!customer) {
          await sleep(CUSTOMER_GAP_MS);
          continue;
        }
        const page = await getJson(
          `${base}/customers/${customer.id}/subscriptions`,
          'RevenueCat 고객 구독',
        );
        found.push(...page.items);
        await sleep(CUSTOMER_GAP_MS);
      }
    };

    await Promise.all([
      listAll(),
      ...Array.from({ length: CUSTOMER_WORKERS }, worker),
    ]);
    return found;
  };

  // 그날 끝 기준 구독 중 인원
  const subscriptions = async (date) => {
    const [actives, trials, all] = await Promise.all([
      chart('actives', { date, segment: 'product_id' }),
      chart('trials', { date, segment: 'product_id' }),
      scanSubscriptions(),
    ]);
    const byPlan = (values) => {
      const out = { monthly: 0, yearly: 0 };
      for (const [label, value] of Object.entries(values)) {
        const plan = planOf(label);
        if (plan) out[plan] += value;
      }
      return out;
    };
    const paid = byPlan(actives);
    const trial = byPlan(trials);
    return {
      monthly: paid.monthly,
      // 지금 무료 체험은 연간 상품에만 붙는다. 월간 체험이 생기면 줄을 따로 내야 한다
      yearlyTrial: trial.yearly + trial.monthly,
      yearlyPaid: paid.yearly,
      promo: promoAt(all, date),
      canceling: cancelingAt(all, date),
    };
  };

  return { subscriptions };
};
