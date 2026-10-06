// 디스코드 웹훅 클라이언트 — 카드(embed)와 텍스트 메시지 두 가지를 보낸다
import { assertOk } from './http.mjs';

// 응답이 없으면 5초에 끊는다 — 서버리스 함수가 오래 묶이면 Sentry가 웹훅 실패로 본다
const TIMEOUT_MS = 5000;

const withQuery = (url, key, value) => {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
};

const post = async (url, payload) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'LanditAlerts/1.0',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return assertOk(res, '디스코드 전송');
};

// components(버튼)는 앱 소유 웹훅에서만 렌더링되며 with_components 플래그가 필요하다
export const sendEmbed = async (webhookUrl, embed, components) => {
  await post(
    components ? withQuery(webhookUrl, 'with_components', 'true') : webhookUrl,
    { embeds: [embed], ...(components && { components }) },
  );
};

// 지표처럼 복사·검색돼야 하는 알림은 embed 대신 content로 보낸다
export const sendMessage = async (webhookUrl, content) => {
  await post(webhookUrl, { content });
};

// 보낸 메시지(id·channel_id)를 돌려받는다 — 카드에 스레드를 달 때 필요하다
export const sendEmbedWithReceipt = async (webhookUrl, embed) => {
  const res = await post(withQuery(webhookUrl, 'wait', 'true'), {
    embeds: [embed],
  });
  return res.json();
};
