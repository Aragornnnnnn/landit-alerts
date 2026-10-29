// 보고서의 잔액 검증·실패 표기·전체 키 내역·전송 중복 방지를 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BILLING_URL, collectReport, postReport, previousDate, validateBalance } from './report.mjs';
import { kstDayRange } from './costs.mjs';
import { runReport } from './run.mjs';
const now = new Date('2026-10-29T01:00:00Z');
const balance = { source: BILLING_URL, organizationId: 'org-test', observedAt: now.toISOString(), status: 'ok', currency: 'usd', usd: 20.25 };
const options = { balance, organizationId: 'org-test', adminKey: 'test', now };
const { start, end } = kstDayRange('2026-10-28');
const costReply = (results = []) => ({ ok: true, json: async () => ({ has_more: false, data: [{ start_time: start, end_time: end, results }] }) });
const costs = [ { api_key_id: 'key-prod', amount: { currency: 'usd', value: 1.2 } }, { api_key_id: null, amount: { currency: 'usd', value: 0.3 } } ];

test('한국 날짜 변경·연말·윤년에서 전날을 계산한다', () => {
  assert.equal(previousDate(new Date('2026-12-31T15:00:00Z')), '2026-12-31');
  assert.equal(previousDate(new Date('2024-03-01T01:00:00Z')), '2024-02-29');
});

test('잔액과 조직·확인 시각을 검증하며 자동충전 금액은 사용하지 않는다', () => {
  assert.equal(validateBalance(balance, 'org-test', now), 20.25);
  assert.equal(validateBalance({ ...balance, status: 'unavailable', usd: undefined }, 'org-test', now), null);
  assert.throws(() => validateBalance(balance, 'org-other', now), /조직 ID/);
  assert.throws(() => validateBalance({ ...balance, observedAt: '2026-10-28T01:00:00Z' }, 'org-test', now), /확인 시각/);
  assert.throws(() => validateBalance({ ...balance, usd: null }, 'org-test', now), /형식/);
});

test('정확한 비용·미분류 비용과 CSV 전부를 전달한다', async () => {
  const report = await collectReport({ ...options, fetchImpl: async () => costReply(costs) });
  assert.match(report.content, /\$20.25/);
  assert.match(report.content, /\$1.5000/);
  assert.match(report.content, /키 미분류·공통 비용/);
  assert.match(report.csv, /key-prod,1.2\nunattributed,0.3/);
  const many = Array.from({ length: 100 }, (_, i) => ({ api_key_id: `key-${i}`, amount: { currency: 'usd', value: i } }));
  const long = await collectReport({ ...options, fetchImpl: async () => costReply(many) });
  assert.ok(long.content.length < 2000);
  assert.equal(long.csv.trim().split('\n').length, 101);
});

test('키 미설정·조회 실패는 0으로 위장하지 않고 원시 예외를 감춘다', async () => {
  const missing = await collectReport({ ...options, adminKey: '' });
  assert.match(missing.content, /Admin API key 미설정/);
  assert.equal(missing.complete, false);
  const failed = await collectReport({ ...options, fetchImpl: async () => { throw new Error('SECRET'); } });
  assert.match(failed.content, /확인 불가/);
  assert.doesNotMatch(failed.content, /SECRET|전날 사용액/);
  const noBalance = await collectReport({ ...options, balance: { ...balance, status: 'unavailable' }, fetchImpl: async () => costReply(costs) });
  assert.match(noBalance.content, /잔액: 확인 불가/);
  assert.match(noBalance.content, /\$1.5000/);
});

test('웹훅은 멘션을 막고 CSV와 영수증 요청을 보낸다', async () => {
  const report = await collectReport({ ...options, fetchImpl: async () => costReply(costs) });
  const id = await postReport({ webhookUrl: 'https://discord.com/api/webhooks/123/test', report, fetchImpl: async (url, init) => {
    assert.equal(url.searchParams.get('wait'), 'true');
    const payload = JSON.parse(init.body.get('payload_json'));
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    assert.equal(await init.body.get('files[0]').text(), report.csv);
    return { ok: true, json: async () => ({ id: '1234' }) };
  } });
  assert.equal(id, '1234');
  await assert.rejects(postReport({ webhookUrl: 'https://example.com/api/webhooks/123/test', report }), /형식 오류/);
});

const setup = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'openai-report-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const balancePath = join(dir, 'balance.json');
  await writeFile(balancePath, JSON.stringify(balance));
  const env = { OPENAI_STATE_DIR: join(dir, 'state'), OPENAI_ORG_ID: 'org-test', OPENAI_ADMIN_KEY: 'test', DISCORD_WEBHOOK_OPENAI: 'https://discord.com/api/webhooks/123/test' };
  return { balancePath, env, now, send: true };
};

test('같은 날짜 재실행은 API·웹훅 호출 없이 끝난다', async (t) => {
  const opts = await setup(t);
  let posts = 0;
  const fetchImpl = async (_url, init) => {
    if (init.method !== 'POST') return costReply(costs);
    posts++;
    return { ok: true, json: async () => ({ id: '12345' }) };
  };
  assert.equal((await runReport({ ...opts, fetchImpl })).status, 'sent');
  assert.equal((await runReport({ ...opts, fetchImpl: () => assert.fail('중복 호출') })).status, 'already-sent');
  assert.equal(posts, 1);
});

test('전송 성공 여부가 불확실하면 pending을 남겨 재전송을 막는다', async (t) => {
  const opts = await setup(t);
  const fetchImpl = async (_url, init) => {
    if (init.method !== 'POST') return costReply(costs);
    throw new Error('connection lost');
  };
  await assert.rejects(runReport({ ...opts, fetchImpl }));
  const state = JSON.parse(await readFile(join(opts.env.OPENAI_STATE_DIR, '2026-10-28.json'), 'utf8'));
  assert.equal(state.status, 'pending');
  await assert.rejects(runReport({ ...opts, fetchImpl: () => assert.fail('재전송 금지') }), /불확실/);
});

test('동시 실행은 하나만 전송한다', async (t) => {
  const opts = await setup(t);
  let unblock;
  let reached;
  const gate = new Promise((resolve) => { unblock = resolve; });
  const waiting = new Promise((resolve) => { reached = resolve; });
  const first = runReport({ ...opts, fetchImpl: async (_url, init) => {
    if (init.method !== 'POST') return costReply(costs);
    reached();
    await gate;
    return { ok: true, json: async () => ({ id: '12345' }) };
  } });
  await waiting;
  try { await assert.rejects(runReport(opts), /다른 전송/); }
  finally { unblock(); }
  assert.equal((await first).status, 'sent');
});
