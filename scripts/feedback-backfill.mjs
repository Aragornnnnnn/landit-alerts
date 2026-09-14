// 슈퍼베이스에 쌓인 편지함 피드백을 오래된 순으로 전부 디스코드에 보낸다 — 웹훅 연결 전에 들어온 피드백용 1회성 스크립트
// 사용: node --env-file=<슈퍼베이스 env> --env-file=<디스코드 env> scripts/feedback-backfill.mjs [--dry-run] [--after=<피드백 id>]
import { sendEmbed } from '../src/discord.mjs';
import { buildFeedbackEmbed } from '../src/feedback.mjs';
import { assertOk } from '../src/http.mjs';

const { SUPABASE_URL, SUPABASE_SECRET_KEY, DISCORD_WEBHOOK_FEEDBACK } =
  process.env;
const dryRun = process.argv.includes('--dry-run');
// 이 id보다 큰 피드백만 보낸다 — 웹훅이 이미 보낸 것과 겹치지 않게
const after = Number(
  process.argv
    .find((a) => a.startsWith('--after='))
    ?.slice('--after='.length) ?? 0,
);
// 디스코드 웹훅은 분당 30건 언저리에서 막힌다 — 그 아래로 천천히 보낸다
const INTERVAL_MS = 2500;

const missing = [
  !SUPABASE_URL && 'SUPABASE_URL',
  !SUPABASE_SECRET_KEY && 'SUPABASE_SECRET_KEY',
  !dryRun && !DISCORD_WEBHOOK_FEEDBACK && 'DISCORD_WEBHOOK_FEEDBACK',
].filter(Boolean);
if (missing.length) {
  console.error(`환경변수 누락: ${missing.join(', ')}`);
  process.exit(1);
}

const res = await assertOk(
  await fetch(
    `${SUPABASE_URL}/rest/v1/mailbox_feedback?select=*&id=gt.${after}&order=id.asc`,
    {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      },
    },
  ),
  '피드백 조회',
);
const rows = await res.json();
console.log(`피드백 ${rows.length}건${dryRun ? ' (전송 안 함)' : ''}`);

for (const [i, row] of rows.entries()) {
  console.log(
    `${i + 1}/${rows.length} #${row.id} ${row.feedback_type} user ${row.user_profile_id} · ${row.created_at}`,
  );
  if (dryRun) continue;
  await sendEmbed(DISCORD_WEBHOOK_FEEDBACK, buildFeedbackEmbed(row));
  if (i < rows.length - 1) await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
