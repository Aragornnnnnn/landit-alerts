// 디스코드 웹훅으로 embed를 전송하는 얇은 클라이언트
import { assertOk } from './http.mjs';

export const sendEmbed = async (webhookUrl, embed) => {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'LanditAlerts/1.0',
    },
    body: JSON.stringify({ embeds: [embed] }),
  });
  await assertOk(res, '디스코드 전송');
};
