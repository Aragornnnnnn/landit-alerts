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
import { daily, previousDaily, previousWeekly, weekly } from './sample.mjs';

const ESC = '\x1b';
const B = (t) => `${ESC}[1m${t}${ESC}[0m`;
const G = (t) => `${ESC}[32m${t}${ESC}[0m`;
const R = (t) => `${ESC}[31m${t}${ESC}[0m`;

test('증감은 늘면 초록 +, 줄면 빨강 −, 같거나 이전 값이 없으면 비운다', () => {
  assert.equal(formatDelta(123, 114), ` ${G('+9')}`);
  assert.equal(formatDelta(66, 68), ` ${R('−2')}`);
  assert.equal(formatDelta(3, 3), '');
  assert.equal(formatDelta(12, undefined), '');
});

test('제목 줄이 전일 대비 절반 이상, 5명 이상 튀면 앞에 경고를 붙인다', () => {
  const message = buildDailyMessage(daily, { ...previousDaily, signups: 30 });
  assert.ok(message.includes(`⚠️ ${B('🌱 가입 12명')} ${R('−18')}`));
});

test('불릿 줄과 작은 변화에는 경고를 붙이지 않는다', () => {
  const message = buildDailyMessage(daily, {
    ...previousDaily,
    signups: 10,
    subscriptions: { ...previousDaily.subscriptions, yearlyTrial: 1 },
  });
  // 가입 10→12는 20%라 아니고, 체험 1→5는 불릿이라 아니다
  assert.doesNotMatch(message, /⚠️/);
});

test('일일 메시지를 ANSI 코드 블록 하나로 스펙 그대로 조립한다', () => {
  assert.equal(
    buildDailyMessage(daily, previousDaily),
    [
      '```ansi',
      B('📊 랜딧 일일 지표 · 2026년 9월 19일 (토)'),
      '',
      `${B('👥 활성 123명')} ${G('+9')}`,
      `   유료 14명 ${G('+1')}`,
      `   무료 109명 ${G('+8')}`,
      '',
      `${B('🌱 가입 12명')} ${G('+3')}`,
      '',
      B('🚪 어디서 들어왔나'),
      '   알림 34명',
      '      오늘의 시나리오 21명',
      '      표현 이어가기 8명',
      '      편지 답장 6명',
      '   위젯 18명',
      '   직접 71명',
      '',
      `${B('🗣️ 시나리오 완료 66명')} ${R('−2')} · 활성의 54% · 하다가 그만둠 9명`,
      '   유료 12명',
      '   무료 54명',
      '',
      B('💎 유료 14명이 쓴 것'),
      '   시나리오 표현 9명 (64%)',
      '      0개 3명 / 1개 2명 / 2개 1명 / 3개 1명 / 4개 이상 5명',
      '   스몰톡 7명 (50%)',
      '      11판 · 한 판 평균 6.1턴',
      '   스몰톡 표현 4명 (29%)',
      '      0개 3명 / 1개 2명 / 2개 1명 / 3개 이상 1명',
      '',
      B('🔁 D1 리텐션 56% · 그제 가입한 9명 중 어제도 온 사람 5명'),
      '',
      `${B('💳 구독 중 52명')} ${G('+3')}`,
      `   월간 30명 ${G('+1')}`,
      `   연간 19명 ${G('+2')}`,
      `      이 중 해지예정 2명 ${G('+1')}`,
      `      무료체험 중 5명 ${G('+2')}`,
      '      결제 중 14명',
      '   프로모션 3명',
      '```',
    ].join('\n'),
  );
});

test('주간 메시지를 ANSI 코드 블록 하나로 스펙 그대로 조립한다', () => {
  assert.equal(
    buildWeeklyMessage(weekly, previousWeekly),
    [
      '```ansi',
      B('📈 랜딧 주간 지표 · 9월 2주차 (9/7 월 00:00 ~ 9/13 일 23:59)'),
      '',
      `${B('👥 주간 활성 412명')} ${G('+20')}`,
      `   유료 38명 ${G('+6')}`,
      `   무료 374명 ${G('+14')}`,
      '',
      `${B('🌱 가입 68명')} ${G('+11')}`,
      '   온보딩 완료 74%',
      '   첫 시나리오까지 60%',
      '',
      B('🚪 어디서 들어왔나'),
      '   알림 201명',
      '      오늘의 시나리오 152명',
      '      표현 이어가기 23명',
      '      스몰톡 18명',
      '      편지 답장 8명',
      '   위젯 96명',
      '   직접 115명',
      '',
      B('🗣️ 시나리오 완료 210명 · 평균 3.2개'),
      '   1개 61명 · 2개 38명 · 3개 29명 · 4개 22명 · 5개 18명 · 6~10개 42명',
      '',
      B('💎 유료 38명이 일주일 동안 쓴 것'),
      '   시나리오 표현 29명 (76%)',
      '      평균 9.9개',
      '   스몰톡 21명 (55%)',
      '      평균 4.2판 · 한 판 평균 6.2턴',
      '      말한 시간 평균 3분 10초 (최소 40초 · 최대 9분 50초)',
      '   스몰톡 표현 17명 (45%)',
      '      평균 3.6개',
      '',
      B(
        '🔁 주간 리텐션 48% · 8/31~9/6 가입한 71명 중 지난주에 다시 온 사람 34명',
      ),
      '',
      `${B('💳 구독 중 52명')} ${G('+7')}`,
      `   월간 30명 ${G('+3')}`,
      `   연간 19명 ${G('+6')}`,
      `      이 중 해지예정 2명 ${R('−2')}`,
      `      무료체험 중 5명 ${G('+4')}`,
      `      결제 중 14명 ${G('+2')}`,
      `   프로모션 3명 ${R('−2')}`,
      '```',
    ].join('\n'),
  );
});

test('첫 실행은 증감 없이 나간다', () => {
  const message = buildDailyMessage(daily, null);
  assert.doesNotMatch(message, /\[3[12]m/);
  assert.ok(message.includes(`\n${B('👥 활성 123명')}\n`));
});

test('구독을 못 가져오면 그 자리만 비우고 나머지는 보낸다', () => {
  const message = buildDailyMessage(
    { ...daily, subscriptions: null },
    previousDaily,
  );
  assert.ok(message.includes(B('💳 구독 정보를 못 가져왔어요')));
  assert.doesNotMatch(message, /월간/);
  // 앰플리튜드에서 온 줄은 그대로다
  assert.ok(message.includes(`${B('👥 활성 123명')} ${G('+9')}`));
});

test('표현을 한 사람이 완료한 사람보다 많아도 0개 칸이 음수가 되지 않는다', () => {
  const message = buildDailyMessage(
    {
      ...daily,
      scenario: { ...daily.scenario, completedPremium: 5 },
      premiumUsage: {
        ...daily.premiumUsage,
        expression: {
          ...daily.premiumUsage.expression,
          scenario: { users: 9, byCount: [2, 1, 1, 5] },
        },
      },
    },
    null,
  );
  assert.ok(message.includes('0개 0명 / 1개 2명'));
});

test('유료 활성이 0이면 비율 대신 0%로 둔다', () => {
  const message = buildDailyMessage(
    {
      ...daily,
      active: { total: 10, premium: 0 },
      scenario: { completed: 3, completedPremium: 0, abandoned: 0 },
      premiumUsage: {
        expression: {
          scenario: { users: 0, byCount: [0, 0, 0, 0] },
          smalltalk: { users: 0, byCount: [0, 0, 0] },
        },
        smalltalk: { users: 0, count: 0, turnsAverage: 0 },
      },
    },
    null,
  );
  assert.match(message, /시나리오 표현 0명 \(0%\)/);
  assert.match(message, /0개 0명 \/ 1개 0명/);
});

test('말한 시간은 분·초로, 1분 미만은 초만 쓴다', () => {
  assert.equal(formatDuration(190000), '3분 10초');
  assert.equal(formatDuration(40000), '40초');
  assert.equal(formatDuration(60000), '1분 0초');
});

test('주차는 그 주 목요일이 속한 달로 센다', () => {
  assert.equal(weekOfMonth('2026-09-07'), '9월 2주차');
  // 8/31~9/6은 목요일이 9/3이라 9월 1주차
  assert.equal(weekOfMonth('2026-08-31'), '9월 1주차');
  // 9/28~10/4는 목요일이 10/1이라 10월 1주차
  assert.equal(weekOfMonth('2026-09-28'), '10월 1주차');
});

test('디스코드 한 메시지 한도(2000자) 안에 든다', () => {
  assert.ok(buildDailyMessage(daily, previousDaily).length < 2000);
  assert.ok(buildWeeklyMessage(weekly, previousWeekly).length < 2000);
});
