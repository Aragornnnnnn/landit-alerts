// OpenRouter 실응답 형식·UTC 구간·잘린 집계·통합 메시지의 부분 실패를 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBalance, fetchRouterKeyCosts } from './costs.mjs';
import { collectReport, postReport } from '../openai/report.mjs';

const options = { managementKey: 'test-router-secret', date: '2026-10-28' };
const rows = [
  { date__day: '2026-10-28', api_key_id: 'dev-llm', credits_usage: 0.044051 },
  { date__day: '2026-10-28', api_key_id: 'landit-local-pronunciation', credits_usage: 7.454426 },
  { date__day: '2026-10-28', api_key_id: 'prod-llm', credits_usage: 2.458538 },
];
const reply = (data) => ({ ok: true, json: async () => ({ data }) });
const analytics = (data = rows, metadata = { truncated: false, row_count: data.length }) => reply({ data, metadata });

test('잔액은 총 구매 크레딧에서 누적 사용액을 빼고 음수 잔액도 보존한다', async () => {
  assert.equal(await fetchBalance({ ...options, fetchImpl: async () => reply({ total_credits: 100, total_usage: 80.5 }) }), 19.5);
  assert.equal(await fetchBalance({ ...options, fetchImpl: async () => reply({ total_credits: 10, total_usage: 11 }) }), -1);
  await assert.rejects(fetchBalance({ ...options, fetchImpl: async () => reply({ total_credits: 10 }) }), /응답 형식/);
});

test('같은 UTC 날짜의 크레딧 청구분만 이름별로 조회하고 모든 키를 보존한다', async () => {
  const costs = await fetchRouterKeyCosts({ ...options, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/analytics/query');
    assert.equal(init.headers.Authorization, 'Bearer test-router-secret');
    assert.equal(init.redirect, 'error');
    const query = JSON.parse(init.body);
    assert.deepEqual(query.metrics, ['credits_usage']);
    assert.deepEqual(query.dimensions, ['api_key_id']);
    assert.deepEqual(query.time_range, { start: '2026-10-28T00:00:00.000Z', end: '2026-10-29T00:00:00.000Z' });
    return analytics();
  } });
  assert.deepEqual(costs.map(x => x.name), ['landit-local-pronunciation', 'prod-llm', 'dev-llm']);
  assert.equal(costs.reduce((sum, row) => sum + row.usd, 0).toFixed(4), '9.9570');
});

test('잘림·누락·범위 밖 날짜·비정상 금액을 0달러나 전체 합계로 오인하지 않는다', async () => {
  for (const result of [
    analytics(rows, { truncated: true, row_count: 3 }),
    analytics(rows, { row_count: 3 }),
    analytics(rows, { truncated: false, row_count: 4 }),
    analytics([{ ...rows[0], date__day: '2026-10-29' }]),
    analytics([{ ...rows[0], credits_usage: null }]),
    analytics([{ ...rows[0], api_key_id: 'secret\nname' }]),
  ]) await assert.rejects(fetchRouterKeyCosts({ ...options, fetchImpl: async () => result }));
  assert.deepEqual(await fetchRouterKeyCosts({ ...options, fetchImpl: async () => analytics([]) }), []);
  await assert.rejects(fetchRouterKeyCosts({ ...options, managementKey: '' }), /미설정/);
});

const combinedOptions = {
  adminKey: 'test-ai-secret', organizationId: 'org-test', openRouterManagementKey: 'test-router-secret',
  keyNames: { 'key-prod': 'prod_ai' }, now: new Date('2026-10-29T01:00:00Z'),
};
const fetchCombined = async (url, init) => {
  const address = String(url);
  if (address.startsWith('https://api.openai.com/')) return { ok: true, json: async () => ({ has_more: false, data: [{ start_time: 1793145600, end_time: 1793232000, results: [{ api_key_id: 'key-prod', amount: { currency: 'usd', value: 3.08665462 } }] }] }) };
  if (address.endsWith('/credits')) return reply({ total_credits: 100, total_usage: 85.329555225 });
  if (address.endsWith('/analytics/query')) return analytics();
  assert.fail('예상하지 못한 요청');
};

test('두 공급자를 지정 순서의 단일 메시지로 전송하며 파일 첨부를 하지 않는다', async () => {
  const report = await collectReport({ ...combinedOptions, fetchImpl: fetchCombined });
  assert.equal(report.complete, true);
  assert.match(report.content, /^\*\*API 일일 비용 보고\*\*/);
  assert.match(report.content, /### OpenAI[\s\S]*prod\\_ai[\s\S]*### OpenRouter[\s\S]*남은 잔액: \*\*\$14.6704\*\*/);
  assert.match(report.content, /총 사용액: \*\*\$9.9570\*\*/);
  assert.match(report.content, /landit-local-pronunciation: \*\*\$7.4544\*\*/);
  let sends = 0;
  await postReport({ webhookUrl: 'https://discord.com/api/webhooks/123/test', report, fetchImpl: async (_url, init) => {
    sends++;
    const payload = JSON.parse(init.body);
    assert.deepEqual(Object.keys(payload).sort(), ['allowed_mentions', 'content']);
    assert.deepEqual(payload.allowed_mentions, { parse: [] });
    return { ok: true, json: async () => ({ id: '1234' }) };
  } });
  assert.equal(sends, 1);
});

test('한 서비스 실패로 다른 서비스 결과를 버리지 않고 비밀값도 노출하지 않는다', async () => {
  for (const failing of ['https://api.openai.com/', '/credits', '/analytics/query']) {
    const report = await collectReport({ ...combinedOptions, fetchImpl: async (url, init) => {
      if (String(url).includes(failing)) throw new Error('SECRET');
      return fetchCombined(url, init);
    } });
    assert.equal(report.complete, false);
    assert.match(report.content, /확인 불가/);
    assert.doesNotMatch(report.content, /SECRET/);
    if (failing !== '/analytics/query') assert.match(report.content, /\$9.9570/);
    if (failing !== 'https://api.openai.com/') assert.match(report.content, /\$3.0867/);
  }
});
