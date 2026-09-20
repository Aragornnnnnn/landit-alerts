// 예시 숫자로 데일리·위클리 메시지를 조립해 웹훅으로 보낸다 — 실제 조회 없이 모양만 확인하는 용도
import { sendMessage } from '../shared/discord.mjs';
import { buildDailyMessage, buildWeeklyMessage } from './lib.mjs';

const WEBHOOK = process.env.DISCORD_WEBHOOK_METRICS;
if (!WEBHOOK) {
  console.error('환경변수가 필요합니다: DISCORD_WEBHOOK_METRICS');
  process.exit(1);
}

const daily = {
  date: '2026-09-19',
  active: { total: 123, premium: 14 },
  signups: 12,
  entries: { notification: 34, widget: 18 },
  scenario: { completed: 66, completedPremium: 12, abandoned: 9 },
  premiumUsage: {
    expression: { users: 9, byCount: [2, 1, 1, 5], skipped: 2, started: 9 },
    smalltalk: { users: 7, count: 11 },
  },
  subscriptions: { monthly: 30, yearlyTrial: 5, yearlyPaid: 14, promo: 3 },
};
const previousDaily = {
  ...daily,
  active: { total: 114, premium: 13 },
  signups: 9,
  scenario: { ...daily.scenario, completed: 68 },
  subscriptions: { monthly: 29, yearlyTrial: 3, yearlyPaid: 14, promo: 3 },
};

const weekly = {
  range: { start: '2026-09-07', end: '2026-09-13' },
  active: { total: 412, premium: 38 },
  signups: 68,
  onboarding: { started: 92, completed: 68 },
  signupsWithScenario: 41,
  entries: { notification: 201, widget: 96 },
  scenario: { byCount: [61, 38, 29, 22, 18, 15, 27], sevenPremium: 8 },
  premiumUsage: {
    expression: { users: 29, count: 70 },
    smalltalk: { users: 21, count: 88 },
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

await sendMessage(WEBHOOK, buildDailyMessage(daily, previousDaily));
await sendMessage(WEBHOOK, buildWeeklyMessage(weekly, previousWeekly));
console.log('전송 완료 — 데일리·위클리.');
