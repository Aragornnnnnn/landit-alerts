// 디스코드 웹훅 클라이언트 — 카드(embed)와 텍스트 메시지 두 가지를 보낸다
import { assertOk } from './http.mjs';

const post = async (url, payload) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'LanditAlerts/1.0',
    },
    body: JSON.stringify(payload),
  });
  await assertOk(res, '디스코드 전송');
};

// components(버튼)는 앱 소유 웹훅에서만 렌더링되며 with_components 플래그가 필요하다
export const sendEmbed = (webhookUrl, embed, components) =>
  post(components ? `${webhookUrl}?with_components=true` : webhookUrl, {
    embeds: [embed],
    ...(components && { components }),
  });

// 지표처럼 복사·검색돼야 하는 알림은 embed 대신 content로 보낸다
export const sendMessage = (webhookUrl, content) =>
  post(webhookUrl, { content });
