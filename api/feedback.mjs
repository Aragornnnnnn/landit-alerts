// 슈퍼베이스 Database Webhook 수신 엔드포인트 (Vercel 서버리스 함수) — 편지함에 새 피드백이 오면 디스코드로 보낸다
import { timingSafeEqual } from 'node:crypto';

import { waitUntil } from '@vercel/functions';

import { editEmbed, sendEmbedWithReceipt } from '../src/shared/discord.mjs';
import {
  buildFeedbackEmbed,
  parseFeedbackWebhook,
  toSeoulIso,
} from '../src/feedback/lib.mjs';
import {
  buildReplayUrl,
  lookupFeedbackReplay,
  pollFeedbackReplay,
} from '../src/feedback/replay.mjs';

// 첫 조회까지 20초, 이후 점점 늘려 약 4분 동안 찾는다 — vercel.json의 maxDuration(300초) 안에 끝나야 한다
const REPLAY_POLL_DELAYS_MS = [20, 20, 30, 60, 60, 60].map((s) => s * 1000);

// 슈퍼베이스 웹훅 설정의 HTTP 헤더에 넣어 둔 값과 맞는지 본다 — 길이가 다르면 비교 자체를 건너뛴다
const isAuthorized = (header) => {
  const secret = process.env.FEEDBACK_WEBHOOK_SECRET;
  if (!secret || typeof header !== 'string' || header.length !== secret.length)
    return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(secret));
};

const attachReplay = async (webhookUrl, messageId, record) => {
  const apiKey = process.env.AMPLITUDE_API_KEY;
  const secretKey = process.env.AMPLITUDE_SECRET_KEY;
  if (!apiKey || !secretKey || !record.created_at) return;

  const submittedAtMs = Date.parse(toSeoulIso(record.created_at));
  const replay = await pollFeedbackReplay(
    () =>
      lookupFeedbackReplay({
        apiKey,
        secretKey,
        userId: record.user_profile_id,
        submittedAtMs,
      }),
    REPLAY_POLL_DELAYS_MS,
  );
  if (!replay) {
    console.log(`리플레이 못 찾음: 피드백 ${record.id}`);
    return;
  }
  await editEmbed(
    webhookUrl,
    messageId,
    buildFeedbackEmbed(record, buildReplayUrl(replay)),
  );
};

export default async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!isAuthorized(req.headers['x-feedback-secret'])) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const record = parseFeedbackWebhook(req.body);
  // 우리 관심사가 아닌 이벤트는 조용히 받아 준다 — 슈퍼베이스가 재시도하지 않게
  if (!record) return res.status(200).json({ skipped: true });

  const webhookUrl = process.env.DISCORD_WEBHOOK_FEEDBACK;
  const message = await sendEmbedWithReceipt(
    webhookUrl,
    buildFeedbackEmbed(record),
  );
  // 카드는 바로 보내고 응답한다. 리플레이는 함수가 살아 있는 동안 찾아서, 찾으면 같은 카드에 링크를 붙인다
  waitUntil(
    attachReplay(webhookUrl, message.id, record).catch((error) =>
      console.error(error),
    ),
  );
  return res.status(200).json({ sent: true });
};
