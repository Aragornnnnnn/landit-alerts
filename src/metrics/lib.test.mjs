// 지표 알림 순수 로직(증감 표기·메시지 조립) 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDailyMessage,
  buildWeeklyMessage,
  formatDelta,
  formatDuration,
  weekOfMonth,
} from './lib.mjs';

const ESC = '\x1b';
const B = (t) => `${ESC}[1m${t}${ESC}[0m`;
const G = (t) => `${ESC}[32m${t}${ESC}[0m`;
const R = (t) => `${ESC}[31m${t}${ESC}[0m`;

const daily = {
  date: '2026-09-19',
  active: { total: 123, premium: 14 },
  signups: 12,
  entries: { notification: 34, widget: 18 },
  scenario: { completed: 66, completedPremium: 12, abandoned: 9 },
  premiumUsage: {
    expression: { users: 9, byCount: [2, 1, 1, 5] },
    smalltalk: { users: 7, count: 11 },
  },
  subscriptions: { monthly: 30, yearlyTrial: 5, yearlyPaid: 14, promo: 3 },
};

const previous = {
  ...daily,
  active: { total: 114, premium: 13 },
  signups: 9,
  scenario: { ...daily.scenario, completed: 68 },
  subscriptions: { monthly: 29, yearlyTrial: 3, yearlyPaid: 14, promo: 3 },
};

test('증감은 늘면 초록 +, 줄면 빨강 −, 같거나 이전 값이 없으면 비운다', () => {
  assert.equal(formatDelta(123, 114), ` ${G('+9')}`);
  assert.equal(formatDelta(66, 68), ` ${R('−2')}`);
  assert.equal(formatDelta(3, 3), '');
  assert.equal(formatDelta(12, undefined), '');
});

test('제목 줄이 전일 대비 절반 이상, 5명 이상 튀면 앞에 경고를 붙인다', () => {
  const message = buildDailyMessage(daily, { ...previous, signups: 30 });
  assert.ok(message.includes(`⚠️ ${B('🌱 가입 12명')} ${R('−18')}`));
});

test('불릿 줄과 작은 변화에는 경고를 붙이지 않는다', () => {
  const message = buildDailyMessage(daily, {
    ...previous,
    signups: 10,
    subscriptions: { ...previous.subscriptions, yearlyTrial: 1 },
  });
  // 가입 10→12는 20%라 아니고, 체험 1→5는 불릿이라 아니다
  assert.doesNotMatch(message, /⚠️/);
});

test('데일리 메시지를 ANSI 코드 블록 하나로 스펙 그대로 조립한다', () => {
  const message = buildDailyMessage(daily, previous);

  assert.equal(
    message,
    [
      '```ansi',
      B('📊 랜딧 데일리 · 2026년 9월 19일 (토)'),
      '',
      `${B('👥 활성 123명')} ${G('+9')}`,
      `   유료 14 ${G('+1')}`,
      `   무료 109 ${G('+8')}`,
      '',
      `${B('🌱 가입 12명')} ${G('+3')}`,
      '',
      B('🚪 어디서 들어왔나'),
      '   알림 34명',
      '   위젯 18명',
      '   직접 71명',
      '',
      `${B('🗣️ 시나리오 완료 66명')} ${R('−2')} · 활성의 54% · 이탈 9`,
      '   유료 12',
      '   무료 54',
      '',
      B('💎 유료 14명이 쓴 것'),
      '   표현학습 9명 · 64% · 0개 3 / 1개 2 / 2개 1 / 3개 1 / 4개 5',
      '   스몰톡 7명 · 50% · 11건',
      '',
      `${B('💳 구독 중 52명')} ${G('+3')}`,
      `   월간 30 ${G('+1')}`,
      `   연간 · 7일 무료체험 5 ${G('+2')}`,
      '   연간 · 결제 14',
      '   프로모션 3',
      '```',
    ].join('\n'),
  );
});

test('첫 실행은 증감 없이 나간다', () => {
  const message = buildDailyMessage(daily, null);
  assert.doesNotMatch(message, /\[3[12]m/);
  assert.ok(message.includes(`\n${B('👥 활성 123명')}\n`));
});

test('유료 활성이 0이면 비율 대신 0%로 둔다', () => {
  const message = buildDailyMessage(
    {
      ...daily,
      active: { total: 10, premium: 0 },
      scenario: { completed: 3, completedPremium: 0, abandoned: 0 },
      premiumUsage: {
        expression: { users: 0, byCount: [0, 0, 0, 0] },
        smalltalk: { users: 0, count: 0 },
      },
    },
    null,
  );
  assert.match(message, /표현학습 0명 · 0% ·/);
  assert.match(message, /0개 0 \/ 1개 0/);
});

test('디스코드 한 메시지 한도(2000자) 안에 든다', () => {
  assert.ok(buildDailyMessage(daily, previous).length < 2000);
});

const weekly = {
  range: { start: '2026-09-07', end: '2026-09-13' },
  active: { total: 412, premium: 38 },
  activeDays: { all: 3.2, premium: 5.1, free: 3.0 },
  signups: 68,
  onboarding: { started: 92, completed: 68 },
  signupsWithScenario: 41,
  entries: { notification: 201, widget: 96 },
  scenario: {
    byCount: [61, 38, 29, 22, 18, 15, 27],
    sevenPremium: 8,
    completedPremium: 120,
  },
  premiumUsage: {
    expression: { scenario: 288, smalltalk: 61 },
    smalltalk: {
      count: 88,
      turnsAverage: 6.2,
      speaking: { average: 190000, min: 40000, max: 590000 },
    },
  },
  retention: { cohort: 71, d1: 34, d7: 15 },
  subscriptions: { monthly: 30, yearlyTrial: 5, yearlyPaid: 14, promo: 3 },
  widget: { installed: 14, removed: 5 },
};

const previousWeekly = {
  ...weekly,
  active: { total: 392, premium: 32 },
  signups: 57,
  subscriptions: { monthly: 27, yearlyTrial: 1, yearlyPaid: 12, promo: 5 },
};

test('위클리 메시지를 ANSI 코드 블록 하나로 스펙 그대로 조립한다', () => {
  const message = buildWeeklyMessage(weekly, previousWeekly);

  assert.equal(
    message,
    [
      '```ansi',
      B('📈 랜딧 위클리 · 9월 2주차 · 9/7 (월) 00:00 ~ 9/13 (일) 23:59'),
      '',
      `${B('👥 주간 활성 412명')} ${G('+20')} · 한 사람이 평균 3.2일 접속`,
      `   유료 38 ${G('+6')} · 5.1일`,
      `   무료 374 ${G('+14')} · 3.0일`,
      '',
      `${B('🌱 가입 68명')} ${G('+11')} · 온보딩 완료 74% · 첫 시나리오까지 60%`,
      '',
      B('🚪 어디서 들어왔나'),
      '   알림 201명 · 위젯 96명 · 직접 115명',
      '',
      B('🗣️ 시나리오 · 한 사람이 평균 3.2개 완료 (유저 210명)'),
      '   1개 61 · 2개 38 · 3개 29 · 4개 22 · 5개 18 · 6개 15 · 7개 27',
      '   7개 완료 27명 · 유료 8 / 무료 19',
      '',
      B('💎 유료 38명이 쓴 것'),
      '   시나리오 표현 · 한 사람이 평균 7.6개 · 한 판당 2.4개 / 4개',
      '   스몰톡 표현 · 한 사람이 평균 1.6개 · 한 판당 0.7개',
      '   스몰톡 · 한 사람이 평균 2.3판 · 한 판 6.2턴',
      '   말한 시간 · 평균 3분 10초 · 최소 40초 · 최대 9분 50초',
      '',
      B('🔁 8/31~9/6 가입 71명'),
      '   하루 뒤 48% · 일주일 뒤 21% 남음',
      '',
      `${B('💳 구독 중 52명')} ${G('+7')}`,
      `   월간 30 ${G('+3')}`,
      `   연간 · 7일 무료체험 5 ${G('+4')}`,
      `   연간 · 결제 14 ${G('+2')}`,
      `   프로모션 3 ${R('−2')}`,
      '',
      `${B(`📱 위젯 순증 ${G('+9')}`)} (설치 14 / 제거 5)`,
      '```',
    ].join('\n'),
  );
});

test('말한 시간은 분·초로, 1분 미만은 초만 쓴다', () => {
  assert.equal(formatDuration(190000), '3분 10초');
  assert.equal(formatDuration(40000), '40초');
  assert.equal(formatDuration(60000), '1분 0초');
});

test('위젯 순증이 0이거나 음수여도 표시된다', () => {
  const zero = buildWeeklyMessage(
    { ...weekly, widget: { installed: 3, removed: 3 } },
    null,
  );
  assert.ok(zero.includes(`${B('📱 위젯 순증 0')} (설치 3 / 제거 3)`));
  const minus = buildWeeklyMessage(
    { ...weekly, widget: { installed: 1, removed: 4 } },
    null,
  );
  assert.ok(
    minus.includes(`${B(`📱 위젯 순증 ${R('−3')}`)} (설치 1 / 제거 4)`),
  );
});

test('주차는 그 주 목요일이 속한 달로 센다', () => {
  assert.equal(weekOfMonth('2026-09-07'), '9월 2주차');
  // 8/31~9/6은 목요일이 9/3이라 9월 1주차
  assert.equal(weekOfMonth('2026-08-31'), '9월 1주차');
  // 9/28~10/4는 목요일이 10/1이라 10월 1주차
  assert.equal(weekOfMonth('2026-09-28'), '10월 1주차');
});
