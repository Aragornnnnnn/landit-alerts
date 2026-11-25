// RDS 지표 요청이 기존 응답 계약과 팀 계정 제외를 유지하는지 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TEAM_USER_IDS } from './amplitude.mjs';
import { createRdsClient } from './rds.mjs';

test('팀 계정을 제외한 RDS 조회 결과를 기존 지표 형식으로 돌려준다', async () => {
  const payload = { streak: { top: 3, users: [80] }, scenarios: { top: 7, users: [91] } };
  const url = 'https://api.example.com/internal/rds/metrics';
  const client = createRdsClient({
    url, token: 'test-only', fetchImpl: async (target, options) => {
      assert.equal(target, url);
      assert.equal(options.headers.Authorization, 'Bearer test-only');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), {
        target_date: '2026-11-26', excluded_ids: TEAM_USER_IDS.map(Number),
      });
      return Response.json(payload);
    },
  });

  assert.deepEqual(await client.records('2026-11-26'), payload);
});

test('HTTPS 조회 경로에만 인증 토큰을 보낸다', () => {
  assert.throws(() => createRdsClient({ url: 'http://example.com', token: 'test-only' }), /HTTPS/);
});
