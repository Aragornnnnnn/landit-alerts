// 지표 알림 실행부 — 어제(일일) 또는 지난주(주간)를 조립해 디스코드로 보낸다.
// 사용: node src/metrics/run.mjs daily|weekly [기준일 YYYY-MM-DD]. 웹훅은 DISCORD_WEBHOOK_METRICS_DAILY / _WEEKLY
import { sendMessage } from '../shared/discord.mjs';
import { createAmplitudeClient, createAmplitudeExtras } from './amplitude.mjs';
import {
  collectDaily,
  collectWeekly,
  kstDate,
  lastWeekOf,
  yesterdayOf,
} from './collect.mjs';
import { buildDailyMessage, buildWeeklyMessage } from './lib.mjs';
import { createRevenueCatClient } from './revenuecat.mjs';

const mode = process.argv[2];
if (mode !== 'daily' && mode !== 'weekly') {
  console.error('사용: node src/metrics/run.mjs daily|weekly [YYYY-MM-DD]');
  process.exit(1);
}

const required = [
  'AMPLITUDE_API_KEY',
  'AMPLITUDE_SECRET_KEY',
  'REVENUECAT_API_KEY',
  'REVENUECAT_PROJECT_ID',
  mode === 'daily'
    ? 'DISCORD_WEBHOOK_METRICS_DAILY'
    : 'DISCORD_WEBHOOK_METRICS_WEEKLY',
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`환경변수가 필요합니다: ${missing.join(', ')}`);
  process.exit(1);
}

const clients = {
  amplitude: createAmplitudeClient({
    apiKey: process.env.AMPLITUDE_API_KEY,
    secretKey: process.env.AMPLITUDE_SECRET_KEY,
  }),
  extras: createAmplitudeExtras({
    apiKey: process.env.AMPLITUDE_API_KEY,
    secretKey: process.env.AMPLITUDE_SECRET_KEY,
  }),
  revenuecat: createRevenueCatClient({
    apiKey: process.env.REVENUECAT_API_KEY,
    projectId: process.env.REVENUECAT_PROJECT_ID,
  }),
};

const today = process.argv[3] ?? kstDate();
const webhook = process.env[required.at(-1)];

// 조회가 하나라도 실패하면 보내지 않는다 — 반쪽 숫자보다 빈 아침이 낫다
const message =
  mode === 'daily'
    ? await (async () => {
        const date = yesterdayOf(today);
        const [current, previous] = await Promise.all([
          collectDaily(clients, date),
          collectDaily(clients, yesterdayOf(date)),
        ]);
        return buildDailyMessage(current, previous);
      })()
    : await (async () => {
        const week = lastWeekOf(today);
        const [current, previous] = await Promise.all([
          collectWeekly(clients, week),
          collectWeekly(clients, lastWeekOf(week.start)),
        ]);
        return buildWeeklyMessage(current, previous);
      })();

console.log(message);
await sendMessage(webhook, message);
console.log(`전송 완료 — ${mode}.`);
