// Supabase의 레퍼럴 INSERT 웹훅을 인증한 뒤 운영 디스코드 채널로 전달한다.
import { timingSafeEqual } from 'node:crypto';

import { sendEmbedWithReceipt } from '../src/shared/discord.mjs';
import {
  buildReferralEmbed,
  isReferralInsert,
  parseReferralWebhook,
} from '../src/referral/lib.mjs';

import { buildReferralRiskEmbed, isReferralRisk, parseReferralRisk } from '../src/referral/risk.mjs';

const isAuthorized = (header) => {
  const secret = process.env.REFERRAL_WEBHOOK_SECRET;
  if (!secret || typeof header !== 'string') return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export default async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  if (!isAuthorized(req.headers['x-referral-secret'])) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const risk = isReferralRisk(req.body);
  if (!risk && !isReferralInsert(req.body)) {
    return res.status(200).json({ skipped: true });
  }
  const record = risk ? parseReferralRisk(req.body) : parseReferralWebhook(req.body);
  if (!record) return res.status(400).json({ error: risk ? 'invalid_referral_risk' : 'invalid_referral' });

  const webhookUrl = process.env.DISCORD_WEBHOOK_REFERRAL;
  if (!webhookUrl) {
    return res.status(503).json({ error: 'not_configured' });
  }
  try {
    // wait=true로 디스코드가 메시지를 저장한 응답까지 확인한다.
    await sendEmbedWithReceipt(webhookUrl, risk ? buildReferralRiskEmbed(record) : buildReferralEmbed(record));
    return res.status(200).json({ sent: true });
  } catch {
    // fetch 예외에는 Webhook URL이 포함될 수 있어 원문을 기록하거나 돌려주지 않는다.
    console.error(`referral ${risk ? 'risk ' : ''}${record.id}: discord delivery failed`);
    return res.status(502).json({ error: 'delivery_failed' });
  }
};
