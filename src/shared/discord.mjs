// 디스코드 웹훅으로 embed를 전송하는 얇은 클라이언트
import { assertOk } from './http.mjs';

// components(버튼)는 앱 소유 웹훅에서만 렌더링되며 with_components 플래그가 필요하다
export const sendEmbed = async (webhookUrl, embed, components) => {
  const url = components ? `${webhookUrl}?with_components=true` : webhookUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'LanditAlerts/1.0',
    },
    body: JSON.stringify({
      embeds: [embed],
      ...(components && { components }),
    }),
  });
  await assertOk(res, '디스코드 전송');
};

// 텍스트 메시지 전송 — 지표처럼 복사·검색돼야 하는 알림은 embed 대신 content로 보낸다
export const sendMessage = async (webhookUrl, content) => {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'LanditAlerts/1.0',
    },
    body: JSON.stringify({ content }),
  });
  await assertOk(res, '디스코드 전송');
};
