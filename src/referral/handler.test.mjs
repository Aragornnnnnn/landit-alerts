// 실제 외부 발송 없이 웹훅 인증·응답과 디스코드 실패 처리를 검증한다.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import handler from '../../api/referral.mjs';

const originalFetch = globalThis.fetch;
const originalSecret = process.env.REFERRAL_WEBHOOK_SECRET;
const originalWebhook = process.env.DISCORD_WEBHOOK_REFERRAL;
const originalConsoleError = console.error;
const calls = [];
const request = (overrides = {}) => ({
  method: 'POST',
  headers: { 'x-referral-secret': 'test-secret' },
  body: {
    type: 'INSERT',
    schema: 'public',
    table: 'referral',
    record: {
      id: '12',
      inviter_id: '100',
      invitee_id: '200',
      inviter_nickname: '민수',
      invitee_nickname: '지은',
      registered_at: '2026-10-23T09:30:00+09:00',
    },
  },
  ...overrides,
});
const response = () => ({
  code: 200,
  headers: {},
  setHeader(key, value) {
    this.headers[key] = value;
  },
  status(code) {
    this.code = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
  end() {
    return this;
  },
});

beforeEach(() => {
  process.env.REFERRAL_WEBHOOK_SECRET = 'test-secret';
  process.env.DISCORD_WEBHOOK_REFERRAL = 'https://discord.com/api/webhooks/1/test';
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'message-1' }));
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  for (const [key, value] of [
    ['REFERRAL_WEBHOOK_SECRET', originalSecret],
    ['DISCORD_WEBHOOK_REFERRAL', originalWebhook],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('POST 외의 요청은 405이고 외부 호출이 없다', async () => {
  const res = response();
  await handler(request({ method: 'GET' }), res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, 'POST');
  assert.equal(calls.length, 0);
});

test('누락·오류·복수·멀티바이트 비밀 헤더를 401로 거부한다', async () => {
  for (const header of [undefined, 'wrong', ['test-secret'], '한'.repeat(11)]) {
    const res = response();
    await handler(request({ headers: { 'x-referral-secret': header } }), res);
    assert.equal(res.code, 401);
  }
  delete process.env.REFERRAL_WEBHOOK_SECRET;
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 401);
  assert.equal(calls.length, 0);
});

test('다른 이벤트는 건너뛰고 잘못된 등록 데이터는 400으로 답한다', async () => {
  const skipped = response();
  await handler(request({ body: { type: 'UPDATE' } }), skipped);
  assert.deepEqual(skipped.body, { skipped: true });
  const invalid = response();
  await handler(request({ body: { ...request().body, record: {} } }), invalid);
  assert.equal(invalid.code, 400);
  assert.equal(calls.length, 0);
});

test('디스코드 URL이 없으면 503으로 답한다', async () => {
  delete process.env.DISCORD_WEBHOOK_REFERRAL;
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 503);
  assert.equal(calls.length, 0);
});

test('인증된 등록은 wait=true로 카드 한 장을 보내고 성공 응답한다', async () => {
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { sent: true });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get('wait'), 'true');
  assert.equal(calls[0].body.embeds[0].fields[0].value, '민수 · user 100');
  assert.equal(calls[0].body.embeds[0].fields[1].value, '지은 · user 200');
});

test('429와 네트워크 오류는 502이며 비밀 URL·응답 원문을 노출하지 않는다', async () => {
  const logs = [];
  console.error = (text) => logs.push(text);
  for (const fail of ['http', 'network']) {
    globalThis.fetch = async () => {
      if (fail === 'network')
        throw new Error(process.env.DISCORD_WEBHOOK_REFERRAL);
      return new Response('secret response', { status: 429 });
    };
    const res = response();
    await handler(request(), res);
    assert.equal(res.code, 502);
    assert.deepEqual(res.body, { error: 'delivery_failed' });
  }
  assert.equal(logs.length, 2);
  assert.ok(logs.every((line) => line === 'referral 12: discord delivery failed'));
});

test('인증된 이상 징후는 같은 채널로 검토 카드 한 장만 보낸다', async () => {
  const req = request();
  req.body = {
    type: 'REFERRAL_RISK', schema: 'landit_alerts', table: 'referral_risk_event',
    record: { id: '1', rule_code: 'INVITE_BURST', inviter_id: '100',
      inviter_nickname: '민수', detected_at: '2026-10-23T14:00:00+09:00',
      window_minutes: 10, observed_count: 3, matched_count: 3, min_count: 3,
      threshold_percent: null, evidence_referral_ids: ['10','11','12'] },
  };
  const res = response();
  await handler(req, res);
  assert.deepEqual(res.body, { sent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.embeds[0].title, '⚠️ 친구 초대 이상 징후');
  const invalid = response();
  req.body.record = {};
  await handler(req, invalid);
  assert.equal(invalid.code, 400);
  assert.deepEqual(invalid.body, { error: 'invalid_referral_risk' });
  assert.equal(calls.length, 1);
});
