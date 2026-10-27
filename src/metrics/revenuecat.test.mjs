// RevenueCat 차트 응답을 구독 수로 옮기는 순수 함수 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planOf, promoAt, totalRevenue, valuesAt } from './revenuecat.mjs';

test('상품 이름에서 월간·연간을 가른다', () => {
  assert.equal(
    planOf('Premium Yearly (com.saynow.app.premium.yearly)'),
    'yearly',
  );
  assert.equal(
    planOf('Premium Yearly (Android) (com.saynow.app.premium.yearly:yearly)'),
    'yearly',
  );
  assert.equal(
    planOf('Premium Monthly (com.saynow.app.premium.monthly)'),
    'monthly',
  );
  assert.equal(planOf('Total'), null);
});

test('차트 값에서 특정 날짜의 세그먼트별 값을 꺼낸다', () => {
  const chart = {
    segments: [
      { display_name: 'Total', is_total: true },
      {
        display_name: 'Premium Yearly (com.saynow.app.premium.yearly)',
        is_total: false,
      },
      {
        display_name: 'Premium Monthly (com.saynow.app.premium.monthly)',
        is_total: false,
      },
    ],
    values: [
      { cohort: 1789689600, segment: 0, value: 5 },
      { cohort: 1789689600, segment: 1, value: 3 },
      { cohort: 1789689600, segment: 2, value: 2 },
      { cohort: 1789776000, segment: 0, value: 6 },
      { cohort: 1789776000, segment: 1, value: 4 },
      { cohort: 1789776000, segment: 2, value: 2 },
    ],
  };
  assert.deepEqual(valuesAt(chart, '2026-09-19'), {
    Total: 6,
    'Premium Yearly (com.saynow.app.premium.yearly)': 4,
    'Premium Monthly (com.saynow.app.premium.monthly)': 2,
  });
});

test('세그먼트 없는 차트는 Total 하나로 온다', () => {
  const chart = {
    segments: [],
    values: [{ cohort: 1789776000, measure: 0, value: 229 }],
  };
  assert.deepEqual(valuesAt(chart, '2026-09-19'), { Total: 229 });
});

test('프로모션은 그날 끝(KST)에 살아 있던 프로덕션 구독만 센다', () => {
  const day = (iso) => new Date(`${iso}T12:00:00+09:00`).getTime();
  const subs = [
    {
      store: 'promotional',
      environment: 'production',
      starts_at: day('2026-09-10'),
      ends_at: null,
      current_period_ends_at: day('2026-10-10'),
    },
    // 그날 낮에 끝난 부여 — 그날 끝엔 없다
    {
      store: 'promotional',
      environment: 'production',
      starts_at: day('2026-09-10'),
      ends_at: day('2026-09-19'),
      current_period_ends_at: day('2026-09-19'),
    },
    // 다음날 시작 — 아직 없다
    {
      store: 'promotional',
      environment: 'production',
      starts_at: day('2026-09-20'),
      ends_at: null,
      current_period_ends_at: day('2026-10-20'),
    },
    // 샌드박스·스토어 구독은 제외
    {
      store: 'promotional',
      environment: 'sandbox',
      starts_at: day('2026-09-10'),
      ends_at: null,
      current_period_ends_at: day('2026-10-10'),
    },
    {
      store: 'app_store',
      environment: 'production',
      starts_at: day('2026-09-10'),
      ends_at: null,
      current_period_ends_at: day('2026-10-10'),
    },
  ];
  assert.equal(promoAt(subs, '2026-09-19'), 1);
  assert.equal(promoAt(subs, '2026-09-20'), 2);
});

test('고객 목록이 실패해도 스캔이 멈춘다 — 워커가 무한히 돌지 않는다', async () => {
  const { createRevenueCatClient } = await import('./revenuecat.mjs');
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('nope', { status: 404, headers: new Headers() });
  try {
    const client = createRevenueCatClient({ apiKey: 'x', projectId: 'y' });
    await assert.rejects(() => client.subscriptions('2026-09-19'));
  } finally {
    globalThis.fetch = original;
  }
});

test('프로모션에서 팀 계정은 뺀다', () => {
  const day = (iso) => new Date(`${iso}T12:00:00+09:00`).getTime();
  const promo = (customer_id) => ({
    customer_id,
    store: 'promotional',
    environment: 'production',
    starts_at: day('2026-09-10'),
    ends_at: null,
    current_period_ends_at: day('2026-10-10'),
  });
  // 5·2827은 팀 계정, 1300은 실제 유저
  assert.equal(
    promoAt([promo('5'), promo('2827'), promo('1300')], '2026-09-20'),
    1,
  );
});

test('매출 차트의 기간 합계를 원 단위로 반올림하고, 원화가 아니면 던진다', () => {
  assert.equal(
    totalRevenue({
      yaxis_currency: 'KRW',
      summary: { total: { Revenue: 853349.13, Transactions: 24 } },
    }),
    853349,
  );
  assert.throws(
    () =>
      totalRevenue({
        yaxis_currency: 'USD',
        summary: { total: { Revenue: 630.98 } },
      }),
    /원화가 아님\(USD\)/,
  );
});
