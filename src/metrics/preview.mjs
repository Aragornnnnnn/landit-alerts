// 예시 숫자로 일일·주간 메시지를 조립해 웹훅으로 보낸다 — 실제 조회 없이 모양만 확인하는 용도.
// 사용: DISCORD_WEBHOOK_METRICS_DAILY=<테스트 웹훅> node src/metrics/preview.mjs
import { sendMessage } from '../shared/discord.mjs';
import { buildDailyMessage, buildWeeklyMessage } from './lib.mjs';
import { daily, previousDaily, previousWeekly, weekly } from './sample.mjs';

const webhook = process.env.DISCORD_WEBHOOK_METRICS_DAILY;
if (!webhook) {
  console.error('환경변수가 필요합니다: DISCORD_WEBHOOK_METRICS_DAILY');
  process.exit(1);
}

await sendMessage(webhook, buildDailyMessage(daily, previousDaily));
await sendMessage(webhook, buildWeeklyMessage(weekly, previousWeekly));
console.log('전송 완료 — 일일·주간.');
