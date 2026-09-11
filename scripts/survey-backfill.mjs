// 슈퍼베이스에 쌓인 설문 응답을 오래된 순으로 전부 디스코드에 보낸다 — 웹훅 연결 전에 들어온 응답용 1회성 스크립트
// 사용: node --env-file=<슈퍼베이스 env> --env-file=~/.landit-discord.env scripts/survey-backfill.mjs [--dry-run]
import { sendEmbed } from '../src/discord.mjs';
import { assertOk } from '../src/http.mjs';
import { buildSurveyEmbed } from '../src/survey.mjs';

const { SUPABASE_URL, SUPABASE_SECRET_KEY, DISCORD_WEBHOOK_SURVEY } =
  process.env;
const dryRun = process.argv.includes('--dry-run');
// 디스코드 웹훅은 분당 30건 언저리에서 막힌다 — 그 아래로 천천히 보낸다
const INTERVAL_MS = 2500;

const missing = [
  !SUPABASE_URL && 'SUPABASE_URL',
  !SUPABASE_SECRET_KEY && 'SUPABASE_SECRET_KEY',
  !dryRun && !DISCORD_WEBHOOK_SURVEY && 'DISCORD_WEBHOOK_SURVEY',
].filter(Boolean);
if (missing.length) {
  console.error(`환경변수 누락: ${missing.join(', ')}`);
  process.exit(1);
}

const res = await assertOk(
  await fetch(
    `${SUPABASE_URL}/rest/v1/survey_responses?select=*&order=created_at.asc`,
    {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      },
    },
  ),
  '설문 응답 조회',
);
const rows = await res.json();
console.log(`응답 ${rows.length}건${dryRun ? ' (전송 안 함)' : ''}`);

for (const [i, row] of rows.entries()) {
  console.log(
    `${i + 1}/${rows.length} user ${row.user_id} · ${row.created_at}`,
  );
  if (dryRun) continue;
  await sendEmbed(DISCORD_WEBHOOK_SURVEY, buildSurveyEmbed(row));
  if (i < rows.length - 1) await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
