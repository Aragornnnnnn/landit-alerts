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
    alarm: 5,
  },
  scenario: { completed: 66, completedPremium: 12, abandoned: 9, max: 4 },
  premiumUsage: {
    expression: {
      scenario: { users: 9, byCount: [2, 1, 1, 5] },
      smalltalk: { users: 4, byCount: [2, 1, 1] },
    },
    smalltalk: { users: 7, count: 11, turnsAverage: 6.1 },
  },
  retention: { cohort: 9, returned: 5, start: '2026-09-18', end: '2026-09-18' },
  records: {
    streak: { top: 21, users: [1300, 2303] },
    scenarios: { top: 120, users: [473] },
  },
  subscriptions: {
    monthly: 30,
    yearlyTrial: 5,
    yearlyPaid: 14,
    promo: 3,
    canceling: 2,
  },
  challenge: 6,
};

// 전일·전주 비교값은 증감에 쓰는 줄만 담는다 (collectDailyBaseline이 돌려주는 모양)
export const previousDaily = {
  active: { total: 114, premium: 13 },
  signups: 9,
  scenario: { completed: 68 },
  subscriptions: {
    monthly: 29,
    yearlyTrial: 3,
    yearlyPaid: 14,
    promo: 3,
    canceling: 1,
  },
  challenge: 5,
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
    alarm: 27,
  },
  scenario: {
    users: 210,
    count: 681,
    max: 12,
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
  records: {
    streak: { top: 21, users: [1300, 2303] },
    scenarios: { top: 120, users: [473] },
  },
  subscriptions: {
    monthly: 30,
    yearlyTrial: 5,
    yearlyPaid: 14,
    promo: 3,
    canceling: 2,
  },
  challenge: 6,
};

export const previousWeekly = {
  active: { total: 392, premium: 32 },
  signups: 57,
  subscriptions: {
    monthly: 27,
    yearlyTrial: 1,
    yearlyPaid: 12,
    promo: 5,
    canceling: 4,
  },
  challenge: 4,
};

// 일일 메시지 끝에 붙는 분석·응원 문구 예시 (insight.mjs가 Claude에서 받아 오는 모양)
export const insight = [
  '💡 무료 활성이 +8로 가입(+3)보다 많이 늘었어요. 알림 유입 34명 중 오늘의 시나리오가 21명이라 알림이 끌어온 것일 수 있어요.',
  '💡 유료 14명 중 스몰톡 표현은 4명(29%)에 그쳤어요. 스몰톡은 7명이 했는데 표현으로 안 이어진 사람이 3명이에요.',
  '💪 연간 무료체험이 하루 만에 2명 늘었어요. 체험이 결제로 이어지는 흐름, 오늘도 잘 지켜봐요.',
].join('\n');
