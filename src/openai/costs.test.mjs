// 한국 시간 비용 집계와 페이지 처리의 실패 조건을 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchKeyCosts, kstDayRange } from './costs.mjs';

test('전날 한국 시간 경계와 여러 페이지의 키별 비용을 보존한다', async () => {
  const { start, end } = kstDayRange('2026-10-28');
  assert.equal(new Date(start * 1000).toISOString(), '2026-10-27T15:00:00.000Z');
  let calls = 0;
  const result = await fetchKeyCosts({ adminKey: 'test', date: '2026-10-28', fetchImpl: async (url) => {
    assert.equal(url.searchParams.get('end_time'), String(end));
    calls++;
    return { ok: true, json: async () => ({ data: [{ start_time: start, end_time: end, results: [{ api_key_id: calls === 1 ? 'key-a' : null, amount: { currency: 'usd', value: calls } }] }], has_more: calls === 1, next_page: calls === 1 ? 'next' : null }) };
  }});
  assert.deepEqual(result, [{ apiKeyId: 'key-a', usd: 1 }, { apiKeyId: null, usd: 2 }]);
});

test('범위 밖 버킷과 잘못된 날짜는 거절한다', async () => {
  assert.throws(() => kstDayRange('2026-02-30'));
  const { start, end } = kstDayRange('2026-10-28');
  await assert.rejects(fetchKeyCosts({ adminKey: 'test', date: '2026-10-28', fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ start_time: start - 1, end_time: end, results: [] }] }) }) }), /집계 구간/);
});
