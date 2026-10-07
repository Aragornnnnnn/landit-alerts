// 디스코드 웹훅 클라이언트 테스트 — 카드를 보내고 메시지 위치를 돌려받는지 본다
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { editEmbed, sendEmbedWithReceipt } from './discord.mjs';

const realFetch = globalThis.fetch;
const HOOK = 'https://discord.com/api/webhooks/1/abc';

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('wait=true로 보내고 올라간 메시지를 돌려준다', async () => {
  // Given 메시지를 돌려주는 웹훅
  let called;
  globalThis.fetch = async (url, init) => {
    called = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ id: '111', channel_id: '222' }));
  };

  // When 카드를 보내면
  const message = await sendEmbedWithReceipt(HOOK, { title: '카드' });

  // Then 메시지 위치를 받는다
  assert.equal(called.url, `${HOOK}?wait=true`);
  assert.deepEqual(called.body, { embeds: [{ title: '카드' }] });
  assert.deepEqual(message, { id: '111', channel_id: '222' });
});

test('전송이 실패하면 에러를 던진다', async () => {
  globalThis.fetch = async () => new Response('rate limited', { status: 429 });

  await assert.rejects(
    sendEmbedWithReceipt(HOOK, {}),
    /디스코드 전송 실패 429/,
  );
});

test('웹훅 주소에 쿼리가 이미 있어도 wait를 덧붙인다', async () => {
  let calledUrl;
  globalThis.fetch = async (url) => {
    calledUrl = url;
    return new Response(JSON.stringify({ id: '1', channel_id: '2' }));
  };

  await sendEmbedWithReceipt(`${HOOK}?thread_id=9`, {});

  assert.equal(calledUrl, `${HOOK}?thread_id=9&wait=true`);
});

test('보낸 메시지의 카드를 PATCH로 바꾼다', async () => {
  // Given 수정 요청을 받는 웹훅
  let called;
  globalThis.fetch = async (url, init) => {
    called = { url, method: init.method, body: JSON.parse(init.body) };
    return new Response('{}');
  };

  // When 메시지 id로 카드를 바꾸면
  await editEmbed(HOOK, '111', { title: '새 카드' });

  // Then 그 메시지 주소로 embed만 다시 보낸다
  assert.equal(called.url, `${HOOK}/messages/111`);
  assert.equal(called.method, 'PATCH');
  assert.deepEqual(called.body, { embeds: [{ title: '새 카드' }] });
});
