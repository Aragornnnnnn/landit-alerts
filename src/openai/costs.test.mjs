// 비용 응답의 날짜 경계·키별 집계·페이지·불완전한 결과를 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchKeyCosts, utcDayRange } from './costs.mjs';
const date = '2026-10-28';
const { start, end } = utcDayRange(date);
const row = (api_key_id = 'key-a', value = 1) => ({ api_key_id, amount: { currency: 'usd', value } });
const bucket = (results = [], from = start, to = end) => ({ start_time: from, end_time: to, results });
const reply = (data, extra = {}) => ({ ok: true, json: async () => ({ data, has_more: false, ...extra }) });
const collect = (fetchImpl) => fetchKeyCosts({ adminKey: 'test', organizationId: 'org-test', date, fetchImpl });

test('UTC 날짜 경계와 여러 페이지의 키별 비용을 보존한다', async () => {
  assert.equal(new Date(start * 1000).toISOString(), '2026-10-28T00:00:00.000Z');
  let calls = 0;
  const result = await collect(async (url, options) => {
    assert.equal(url.searchParams.get('start_time'), String(start));
    assert.equal(url.searchParams.get('end_time'), String(end));
    assert.equal(url.searchParams.get('group_by[]'), 'api_key_id');
    assert.equal(options.headers['OpenAI-Organization'], 'org-test');
    calls++;
    if (calls === 2) assert.equal(url.searchParams.get('page'), 'next');
    return reply([bucket([row(calls === 1 ? 'key-a' : null, calls)])], { has_more: calls === 1, next_page: 'next' });
  });
  assert.deepEqual(result, [{ apiKeyId: 'key-a', usd: 1 }, { apiKeyId: null, usd: 2 }]);
});

test('여러 부분 버킷은 구간 전체를 덮는 경우에만 합산한다', async () => {
  const middle = start + 3600;
  assert.deepEqual(await collect(async () => reply([bucket([row()], start, middle), bucket([row('key-a', -0.2)], middle, end)])), [{ apiKeyId: 'key-a', usd: 0.8 }]);
  await assert.rejects(collect(async () => reply([bucket([], start, middle)])), /완전/);
  await assert.rejects(collect(async () => reply([bucket([], start, middle), bucket([], middle + 1, end)])), /누락/);
});

test('명시적인 빈 결과는 0이며 빈 응답·누락·겹침·중복 행은 실패한다', async () => {
  assert.deepEqual(await collect(async () => reply([bucket()])), []);
  await assert.rejects(collect(async () => reply([])), /완전/);
  await assert.rejects(collect(async () => reply([bucket([], start, end - 1), bucket()])), /겹칩니다/);
  await assert.rejects(collect(async () => reply([bucket([row(), row()])])), /중복/);
  await assert.rejects(collect(async () => reply([{ results: [] }])), /집계 구간/);
});

test('범위 밖 버킷·날짜·통화·커서·비밀 키 값은 거절한다', async () => {
  assert.throws(() => utcDayRange('2026-02-30'));
  await assert.rejects(collect(async () => reply([bucket([], start - 1)])), /집계 구간/);
  await assert.rejects(collect(async () => reply([bucket([{ ...row(), amount: { currency: 'eur', value: 1 } }])])), /통화/);
  await assert.rejects(collect(async () => reply([bucket([row('sk-secret')])])), /ID 형식/);
  await assert.rejects(collect(async () => reply([bucket()], { has_more: true, next_page: null })), /커서/);
  await assert.rejects(collect(async () => reply([bucket()], { has_more: true, next_page: 'loop' })), /커서/);
  await assert.rejects(collect(async () => ({ ok: false, status: 401, text: async () => 'SECRET' })), { message: 'OpenAI 비용 조회 실패: HTTP 401' });
});
