// Sentry 이슈 알림 웹훅 수신 엔드포인트 (Vercel 서버리스 함수) — 새 이슈를 프로젝트별 디스코드 채널로 보낸다
import { sendEmbed, sendEmbedWithReceipt } from '../src/shared/discord.mjs';
import {
  buildSentryEmbed,
  isValidSentrySignature,
  parseSentryWebhook,
  resolveSentryChannel,
} from '../src/sentry/lib.mjs';
import { buildTriageDispatch, requestTriage } from '../src/sentry/triage.mjs';

// 서명은 원문 기준이라 Vercel의 body 파싱을 끈다
export const config = { api: { bodyParser: false } };

const readRawBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

export default async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await readRawBody(req);
  if (
    !isValidSentrySignature(
      process.env.SENTRY_CLIENT_SECRET,
      rawBody,
      req.headers['sentry-hook-signature'],
    )
  ) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  // 관심 없는 리소스·프로젝트도 200으로 받아 준다 — 실패가 쌓이면 Sentry가 웹훅을 꺼 버린다
  const alert = parseSentryWebhook(
    req.headers['sentry-hook-resource'],
    JSON.parse(rawBody),
  );
  if (!alert) return res.status(200).json({ skipped: true });

  const webhookUrl = resolveSentryChannel(
    process.env.SENTRY_CHANNELS,
    alert.event.project,
  );
  if (!webhookUrl) {
    console.warn(`채널 미등록 Sentry 프로젝트: ${alert.event.project}`);
    return res.status(200).json({ skipped: true });
  }

  const embed = buildSentryEmbed(alert.event);
  const triageToken = process.env.TRIAGE_DISPATCH_TOKEN;
  if (!triageToken) {
    await sendEmbed(webhookUrl, embed);
    return res.status(200).json({ sent: true });
  }

  // 분석 요청이 실패해도 카드는 이미 나갔다 — 알림 응답은 그대로 성공으로 돌려준다
  const message = await sendEmbedWithReceipt(webhookUrl, embed);
  const dispatch = buildTriageDispatch(alert.event, message);
  try {
    if (dispatch) await requestTriage(triageToken, dispatch);
    else console.warn('이슈 id를 몰라 분석을 요청하지 않았어요');
  } catch (error) {
    console.error(error);
  }
  return res.status(200).json({ sent: true, triage: Boolean(dispatch) });
};
