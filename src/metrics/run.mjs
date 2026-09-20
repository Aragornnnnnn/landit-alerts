// 지표 알림 실행부 — 어제(일일) 또는 지난주(주간)를 조립해 디스코드로 보낸다.
// 사용: node src/metrics/run.mjs daily|weekly [기준일 YYYY-MM-DD]
import { sendMessage } from '../shared/discord.mjs';
import { createAmplitudeClient } from './amplitude.mjs';
import {
  collectDaily,
  collectDailyBaseline,
  collectWeekly,
  collectWeeklyBaseline,
  kstDate,
  lastWeekOf,
  yesterdayOf,
} from './collect.mjs';
import {
  buildDailyMessage,
  buildFailureMessage,
  buildWeeklyMessage,
} from './lib.mjs';
import { createRevenueCatClient } from './revenuecat.mjs';

const MODES = {
  daily: { label: '일일', webhookKey: 'DISCORD_WEBHOOK_METRICS_DAILY' },
  weekly: { label: '주간', webhookKey: 'DISCORD_WEBHOOK_METRICS_WEEKLY' },
};

const mode = MODES[process.argv[2]];
if (!mode) {
  console.error('사용: node src/metrics/run.mjs daily|weekly [YYYY-MM-DD]');
  process.exit(1);
}

const missing = [
  'AMPLITUDE_API_KEY',
  'AMPLITUDE_SECRET_KEY',
  'REVENUECAT_API_KEY',
  'REVENUECAT_PROJECT_ID',
  mode.webhookKey,
].filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`환경변수가 필요합니다: ${missing.join(', ')}`);
  process.exit(1);
}

const clients = {
  amplitude: createAmplitudeClient({
    apiKey: process.env.AMPLITUDE_API_KEY,
    secretKey: process.env.AMPLITUDE_SECRET_KEY,
  }),
  revenuecat: createRevenueCatClient({
    apiKey: process.env.REVENUECAT_API_KEY,
    projectId: process.env.REVENUECAT_PROJECT_ID,
  }),
};

const dailyMessage = async (today) => {
  const date = yesterdayOf(today);
  const [current, previous] = await Promise.all([
    collectDaily(clients, date),
    collectDailyBaseline(clients, yesterdayOf(date)),
  ]);
  return buildDailyMessage(current, previous);
};

const weeklyMessage = async (today) => {
  const week = lastWeekOf(today);
  const [current, previous] = await Promise.all([
    collectWeekly(clients, week),
    collectWeeklyBaseline(clients, lastWeekOf(week.start)),
  ]);
  return buildWeeklyMessage(current, previous);
};

const today = process.argv[3] || kstDate();
const webhook = process.env[mode.webhookKey];

// 지표를 못 만들면 침묵하지 않고 실패를 알린다 — 조용한 아침이 "지표 0"인지 "봇이 죽음"인지 구분되게.
// 구독(RevenueCat)만 실패한 경우는 collect가 그 자리만 비우고 나머지를 살린다
try {
  const message = await (mode === MODES.daily ? dailyMessage : weeklyMessage)(
    today,
  );
  console.log(message);
  await sendMessage(webhook, message);
  console.log(`전송 완료 — ${mode.label}.`);
} catch (error) {
  console.error(error);
  await sendMessage(webhook, buildFailureMessage(mode.label, error.message));
  console.error(`실패를 알렸습니다 — ${mode.label}.`);
  process.exit(1);
}
