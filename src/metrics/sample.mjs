// 메시지 모양을 확인할 때 쓰는 예시 숫자 — 입력 데이터 모양의 정본이다.
// 테스트와 preview가 같이 쓰므로, 수집기가 돌려주는 모양이 바뀌면 여기부터 고친다
export const daily = {
  date: '2026-09-19',
  active: { total: 123, premium: 14 },
  signups: 12,
  entries: {
    notification: 34,
    notificationByCampaign: {
      daily_scenario_reminder: 21,
      continue_expression: 8,
      mailbox_reply: 6,
    },
    widget: 18,
  },
  scenario: { completed: 66, completedPremium: 12, abandoned: 9 },
  premiumUsage: {
    expression: {
      scenario: { users: 9, byCount: [2, 1, 1, 5] },
      smalltalk: { users: 4, byCount: [2, 1, 1] },
    },
    smalltalk: { users: 7, count: 11, turnsAverage: 6.1 },
  },
  retention: { cohort: 9, returned: 5, start: '2026-09-18', end: '2026-09-18' },
  subscriptions: { monthly: 30, yearlyTrial: 5, yearlyPaid: 14, promo: 3 },
};

// 전일·전주 비교값은 증감에 쓰는 줄만 담는다 (collectDailyBaseline이 돌려주는 모양)
export const previousDaily = {
  active: { total: 114, premium: 13 },
  signups: 9,
  scenario: { completed: 68 },
  subscriptions: { monthly: 29, yearlyTrial: 3, yearlyPaid: 14, promo: 3 },
};

export const weekly = {
  range: { start: '2026-09-07', end: '2026-09-13' },
  active: { total: 412, premium: 38 },
  signups: 68,
  onboarding: { started: 92, completed: 68 },
  signupsWithScenario: 41,
  entries: {
    notification: 201,
    notificationByCampaign: {
      daily_scenario_reminder: 152,
      continue_expression: 23,
      small_talk_reminder: 18,
      mailbox_reply: 8,
    },
    widget: 96,
  },
  scenario: {
    users: 210,
    count: 681,
    buckets: [
      ['1개', 61],
      ['2개', 38],
      ['3개', 29],
      ['4개', 22],
      ['5개', 18],
      ['6~10개', 42],
    ],
  },
  premiumUsage: {
    expression: {
      scenario: { users: 29, count: 288 },
      smalltalk: { users: 17, count: 61 },
    },
    smalltalk: {
      users: 21,
      count: 88,
      turnsAverage: 6.2,
      speaking: { average: 190000, min: 40000, max: 590000 },
    },
  },
  retention: {
    cohort: 71,
    returned: 34,
    start: '2026-08-31',
    end: '2026-09-06',
  },
  subscriptions: { monthly: 30, yearlyTrial: 5, yearlyPaid: 14, promo: 3 },
};

export const previousWeekly = {
  active: { total: 392, premium: 32 },
  signups: 57,
  subscriptions: { monthly: 27, yearlyTrial: 1, yearlyPaid: 12, promo: 5 },
};
