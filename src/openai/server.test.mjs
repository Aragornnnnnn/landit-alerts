// 서버 전송 예약과 재실행·실패 복구 및 크론 인증 경계를 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDelivery, deliverPrepared } from './server.mjs';
import { createCronHandler } from './trigger.mjs';
const now = new Date('2026-10-29T01:00:00Z');
const setup = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'openai-server-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { now, env: { OPENAI_STATE_DIR: join(dir, 'cache'), OPENAI_REPORT_FILE: join(dir, 'private', 'report.json'), OPENAI_REPORT_RUN: '123:1', OPENAI_ADMIN_KEY: 'test-secret', OPENAI_ORG_ID: 'org-test', DISCORD_WEBHOOK_OPENAI: 'https://discord.com/api/webhooks/123/test' }, fetchImpl: async () => ({ ok: true, json: async () => ({ has_more: false, data: [{ start_time: 1793145600, end_time: 1793232000, results: [] }] }) }) };
};

test('준비 상태에는 비용·비밀값 없이 pending만 저장하고 영수증 후 sent로 바꾼다', async (t) => {
  const opts = await setup(t);
  assert.equal((await prepareDelivery(opts)).ready, true);
  const file = join(opts.env.OPENAI_STATE_DIR, 'delivery.json');
  const pending = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(pending, { date: '2026-10-28', runId: '123:1', status: 'pending' });
  assert.equal((await deliverPrepared({ ...opts, fetchImpl: async () => ({ ok: true, json: async () => ({ id: '999' }) }) })).messageId, '999');
  assert.equal((await prepareDelivery({ ...opts, fetchImpl: () => assert.fail('조회 금지') })).ready, false);
});

test('복원된 pending은 다른 실행에서 재전송하지 못한다', async (t) => {
  const opts = await setup(t);
  await prepareDelivery(opts);
  await assert.rejects(prepareDelivery(opts), /불확실/);
  await assert.rejects(deliverPrepared({ ...opts, env: { ...opts.env, OPENAI_REPORT_RUN: '123:2' } }), /일치하지/);
});

test('Discord 실패 후 pending을 유지한다', async (t) => {
  const opts = await setup(t);
  await prepareDelivery(opts);
  await assert.rejects(deliverPrepared({ ...opts, fetchImpl: async () => { throw new Error('network'); } }));
  assert.equal(JSON.parse(await readFile(join(opts.env.OPENAI_STATE_DIR, 'delivery.json'), 'utf8')).status, 'pending');
});

const reply = () => ({ code: 0, value: null, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } });
test('크론 인증이 없거나 틀리면 GitHub를 호출하지 않는다', async () => {
  for (const env of [{}, { CRON_SECRET: 'secret' }]) {
    const res = reply();
    await createCronHandler({ env, fetchImpl: () => assert.fail('인증 전 호출') })({ method: 'GET', headers: { authorization: 'Bearer bad' } }, res);
    assert.equal(res.code, 401);
  }
});

test('인증된 크론은 main의 지정 워크플로만 실행한다', async () => {
  const res = reply();
  await createCronHandler({ env: { CRON_SECRET: 'secret', GH_WORKFLOW_TOKEN: 'token' }, fetchImpl: async (url, init) => {
    assert.match(url, /openai-report.yml\/dispatches$/);
    assert.deepEqual(JSON.parse(init.body), { ref: 'main' });
    return { ok: true };
  } })({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);
  assert.equal(res.code, 200);
});

test('GitHub 오류는 토큰이나 응답 본문을 노출하지 않는다', async () => {
  const res = reply();
  await createCronHandler({ env: { CRON_SECRET: 'secret', GH_WORKFLOW_TOKEN: 'token' }, fetchImpl: async () => { throw new Error('TOKEN'); } })({ method: 'GET', headers: { authorization: 'Bearer secret' } }, res);
  assert.equal(res.code, 502);
  assert.doesNotMatch(JSON.stringify(res.value), /TOKEN/);
});
