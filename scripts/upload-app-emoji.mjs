// PNG를 디스코드 앱 이모지로 올리고 카드에서 쓸 id를 찍는다 — 이모지 CDN 주소를 author 아이콘으로 쓰기 위한 1회성 스크립트
// 사용: node --env-file=~/.landit-discord.env scripts/upload-app-emoji.mjs <이름=png경로> ...
import { readFile } from 'node:fs/promises';

import { assertOk } from '../src/shared/http.mjs';

const { DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_BOT_TOKEN) {
  console.error('환경변수 누락: DISCORD_BOT_TOKEN');
  process.exit(1);
}
const headers = {
  Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
  'Content-Type': 'application/json',
};
const API = 'https://discord.com/api/v10';

const app = await (
  await assertOk(
    await fetch(`${API}/oauth2/applications/@me`, { headers }),
    '앱 조회',
  )
).json();

for (const arg of process.argv.slice(2)) {
  const [name, path] = arg.split('=');
  const png = await readFile(path);
  const res = await assertOk(
    await fetch(`${API}/applications/${app.id}/emojis`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        image: `data:image/png;base64,${png.toString('base64')}`,
      }),
    }),
    `이모지 업로드 ${name}`,
  );
  const emoji = await res.json();
  console.log(`${name} → ${emoji.id}`);
}
