// RevenueCat v2 수집기 — 구독 중 인원을 월간·연간 체험·연간 결제·프로모션으로 가른다.
// 유료(actives)·체험(trials)은 상품별 차트에서, 프로모션은 차트에 안 잡혀 고객 전수 조회에서 그날 끝 기준으로 센다
import { assertOk } from '../shared/http.mjs';

const API = 'https://api.revenuecat.com/v2/projects';

export const planOf = (label) => {
  const lower = label.toLowerCase();
  if (lower.includes('yearly')) return 'yearly';
  if (lower.includes('monthly')) return 'monthly';
  return null;
};

// 차트 값 중 해당 날짜(UTC 자정 epoch)의 값을 세그먼트 이름별로
export const valuesAt = (chart, isoDate) => {
  const cohort =
    Date.UTC(
      ...isoDate.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)),
    ) / 1000;
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

const KST_DAY_END_MS = (isoDate) =>
  new Date(`${isoDate}T23:59:59.999+09:00`).getTime();

// 그날 끝(KST)에 살아 있던 프로모션 구독 수. 샌드박스는 뺀다
export const promoAt = (subscriptions, isoDate) => {
  const at = KST_DAY_END_MS(isoDate);
  return subscriptions.filter((sub) => {
    if (sub.store !== 'promotional' || sub.environment !== 'production')
      return false;
    const end = sub.ends_at ?? sub.current_period_ends_at;
    return sub.starts_at <= at && (end == null || end > at);
  }).length;
};

export const createRevenueCatClient = ({ apiKey, projectId }) => {
  const headers = { Authorization: `Bearer ${apiKey}` };

  const chart = async (name, { date, segment }) => {
    const url = new URL(`${API}/${projectId}/charts/${name}`);
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    url.searchParams.set('resolution', '0');
    if (segment) url.searchParams.set('segment', segment);
    const res = await assertOk(
      await fetch(url, { headers }),
      `RevenueCat 차트(${name})`,
    );
    return valuesAt(await res.json(), date);
  };

  const getJson = async (url, label) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await fetch(url, { headers });
      if (res.status !== 429) return (await assertOk(res, label)).json();
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error(`${label} 실패: 재시도 후에도 429`);
  };

  // 고객 전부의 구독을 한 번만 긁어 둔다 (고객 수만큼 호출하므로 한 실행에 한 번)
  let allSubscriptions;
  const scanSubscriptions = async () => {
    if (allSubscriptions) return allSubscriptions;
    const customers = [];
    let url = `${API}/${projectId}/customers?limit=100`;
    while (url) {
      const page = await getJson(url, 'RevenueCat 고객 목록');
      customers.push(...page.items);
      url = page.next_page;
    }
    const found = [];
    const queue = [...customers];
    const worker = async () => {
      while (queue.length) {
        const customer = queue.shift();
        const page = await getJson(
          `${API}/${projectId}/customers/${customer.id}/subscriptions`,
          'RevenueCat 고객 구독',
        );
        found.push(...page.items);
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
    allSubscriptions = found;
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
      yearlyTrial: trial.yearly + trial.monthly,
      yearlyPaid: paid.yearly,
      promo: promoAt(all, date),
    };
  };

  return { chart, subscriptions, scanSubscriptions };
};
