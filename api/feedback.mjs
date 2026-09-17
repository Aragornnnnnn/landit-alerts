// 슈퍼베이스 Database Webhook 수신 엔드포인트 (Vercel 서버리스 함수) — 편지함에 새 피드백이 오면 디스코드로 보낸다
import { timingSafeEqual } from 'node:crypto';

import { sendEmbed } from '../src/shared/discord.mjs';
import {
  buildFeedbackEmbed,
  parseFeedbackWebhook,
} from '../src/feedback/lib.mjs';

// 슈퍼베이스 웹훅 설정의 HTTP 헤더에 넣어 둔 값과 맞는지 본다 — 길이가 다르면 비교 자체를 건너뛴다
const isAuthorized = (header) => {
  const secret = process.env.FEEDBACK_WEBHOOK_SECRET;
  if (!secret || typeof header !== 'string' || header.length !== secret.length)
    return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(secret));
};

export default async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!isAuthorized(req.headers['x-feedback-secret'])) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const record = parseFeedbackWebhook(req.body);
  // 우리 관심사가 아닌 이벤트는 조용히 받아 준다 — 슈퍼베이스가 재시도하지 않게
  if (!record) return res.status(200).json({ skipped: true });

  await sendEmbed(
    process.env.DISCORD_WEBHOOK_FEEDBACK,
    buildFeedbackEmbed(record),
  );
  return res.status(200).json({ sent: true });
};
