// 이름별 텍스트 보고·파일 첨부 금지·실패 표기·전송 중복 방지를 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectReport, parseKeyNames, postReport, previousDate } from './report.mjs';
import { utcDayRange } from './costs.mjs';
import { runReport } from './run.mjs';
const now = new Date('2026-10-29T01:00:00Z');
const options = { organizationId: 'org-test', adminKey: 'test', now, keyNames: { 'key-prod': 'prod_ai', 'key-dev': 'develop_ai' } };
const { start, end } = utcDayRange('2026-10-28');
const costs = [{ api_key_id: 'key-prod', amount: { currency: 'usd', value: 1.2 } }, { api_key_id: 'key-dev', amount: { currency: 'usd', value: 0.3 } }];
const costReply = (results = costs) => ({ ok: true, json: async () => ({ has_more: false, data: [{ start_time: start, end_time: end, results }] }) });

test('완료된 UTC 날짜를 선택하고 연말·윤년을 처리한다', () => {
  assert.equal(previousDate(new Date('2026-12-31T15:00:00Z')), '2026-12-30');
  assert.equal(previousDate(new Date('2024-03-01T01:00:00Z')), '2024-02-29');
});

test('키 이름으로 모든 비용을 표시하고 잔액은 결제 링크로 대체한다', async () => {
  const report = await collectReport({ ...options, fetchImpl: async () => costReply() });
  assert.match(report.content, /prod\\_ai/);
  assert.match(report.content, /develop\\_ai/);
  assert.match(report.content, /\$1.5000/);
  assert.match(report.content, /2026-10-28 09:00–2026-10-29 09:00 KST/);
  assert.match(report.content, /잔액은 OpenAI 결제 화면에서 확인/);
  assert.doesNotMatch(report.content, /key-prod|key-dev|잔액:|CSV/);
  assert.equal(report.csv, undefined);
  const unknown = await collectReport({ ...options, keyNames: {}, fetchImpl: async () => costReply([{ api_key_id: null, amount: { currency: 'usd', value: 1 } }, costs[0]]) });
  assert.match(unknown.content, /미등록 키/);
  assert.match(unknown.content, /키 미분류/);
});

test('잘못된 이름 매핑과 미완료 날짜, 너무 긴 보고는 조용히 누락하지 않는다', async () => {
  assert.throws(() => parseKeyNames('{'), /JSON/);
  assert.throws(() => parseKeyNames('{"key-a":"bad\\nname"}'), /형식/);
  await assert.rejects(collectReport({ ...options, date: '2026-10-29' }), /완료되지/);
  const many = Array.from({ length: 100 }, (_, i) => ({ api_key_id: `key-${i}`, amount: { currency: 'usd', value: i } }));
  await assert.rejects(collectReport({ ...options, fetchImpl: async () => costReply(many) }), /본문 한도/);
});

test('키 미설정·조회 실패를 0으로 위장하지 않고 원시 예외를 감춘다', async () => {
  const missing = await collectReport({ ...options, adminKey: '' });
  assert.match(missing.content, /Admin API key 미설정/);
  assert.equal(missing.complete, false);
  const failed = await collectReport({ ...options, fetchImpl: async () => { throw new Error('SECRET'); } });
  assert.match(failed.content, /확인 불가/);
  assert.doesNotMatch(failed.content, /SECRET|총 사용액/);
});

test('Discord에는 JSON 본문만 보내며 첨부와 멘션을 넣지 않는다', async () => {
  const report = await collectReport({ ...options, fetchImpl: async () => costReply() });
  const id = await postReport({ webhookUrl: 'https://discord.com/api/webhooks/123/test', report, fetchImpl: async (url, init) => {
    assert.equal(url.searchParams.get('wait'), 'true');
    assert.equal(init.headers['Content-Type'], 'application/json');
    const payload = JSON.parse(init.body);
    assert.deepEqual(Object.keys(payload).sort(), ['allowed_mentions', 'content']);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    return { ok: true, json: async () => ({ id: '1234' }) };
  } });
  assert.equal(id, '1234');
  await assert.rejects(postReport({ webhookUrl: 'https://example.com/api/webhooks/123/test', report }), /형식 오류/);
});

const setup = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'openai-report-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { OPENAI_STATE_DIR: join(dir, 'state'), OPENAI_ORG_ID: 'org-test', OPENAI_ADMIN_KEY: 'test', DISCORD_WEBHOOK_OPENAI: 'https://discord.com/api/webhooks/123/test' };
  return { env, now, send: true };
};

test('같은 날짜 재실행은 API·웹훅 호출 없이 끝난다', async (t) => {
  const opts = await setup(t);
  const fetchImpl = async (_url, init) => init.method === 'POST' ? { ok: true, json: async () => ({ id: '12345' }) } : costReply();
  assert.equal((await runReport({ ...opts, fetchImpl })).status, 'sent');
  assert.equal((await runReport({ ...opts, fetchImpl: () => assert.fail('중복 호출') })).status, 'already-sent');
});

test('전송 성공 여부가 불확실하면 pending을 남겨 재전송을 막는다', async (t) => {
  const opts = await setup(t);
  const fetchImpl = async (_url, init) => {
    if (init.method !== 'POST') return costReply();
    throw new Error('connection lost');
  };
  await assert.rejects(runReport({ ...opts, fetchImpl }));
  const state = JSON.parse(await readFile(join(opts.env.OPENAI_STATE_DIR, '2026-10-28.json'), 'utf8'));
  assert.equal(state.status, 'pending');
  await assert.rejects(runReport({ ...opts, fetchImpl: () => assert.fail('재전송 금지') }), /불확실/);
});
