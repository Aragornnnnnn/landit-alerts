// 지표 알림 실행부 — 어제(일일) 또는 지난주(주간)를 조립해 디스코드로 보낸다.
// 사용: node src/metrics/run.mjs daily|weekly [기준일 YYYY-MM-DD]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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

// 같은 기간을 두 번 보내지 않게 마지막으로 보낸 기간을 적어 둔다.
// 버셀 크론이 같은 실행을 두 번 부를 수 있고, 늦게 도착한 깃허브 예약이 겹칠 수도 있다
const STATE_FILE = process.env.STATE_FILE ?? '.state/metrics.json';

const loadState = async () => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
};

const saveState = async (state) => {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
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

// 기간 이름 — 상태 파일에 이걸로 적어 두고 같은 기간을 두 번 보내지 않는다
const periodOf = {
  daily: (today) => yesterdayOf(today),
  weekly: (today) => lastWeekOf(today).end,
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
const modeName = process.argv[2];
const period = periodOf[modeName](today);
const state = await loadState();

if (state[modeName] === period) {
  console.log(
    `이미 보냈습니다 — ${mode.label} ${period}. 아무것도 하지 않습니다.`,
  );
  process.exit(0);
}

try {
  const message = await (mode === MODES.daily ? dailyMessage : weeklyMessage)(
    today,
  );
  console.log(message);
  await sendMessage(webhook, message);
  await saveState({ ...state, [modeName]: period });
  console.log(`전송 완료 — ${mode.label} ${period}.`);
} catch (error) {
  console.error(error);
  await sendMessage(webhook, buildFailureMessage(mode.label, error.message));
  console.error(`실패를 알렸습니다 — ${mode.label}.`);
  process.exit(1);
}
