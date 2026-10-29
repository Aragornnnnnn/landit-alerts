// RevenueCat 차트 응답을 구독 수로 옮기는 순수 함수 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planOf, totalRevenue, valuesAt } from './revenuecat.mjs';

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
