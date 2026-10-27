// 슈퍼베이스 기록 함수 응답을 검사하는 순수 함수 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recordsFromResponse } from './supabase.mjs';

test('함수 응답에서 최고 스트릭과 시나리오 누적 최다를 꺼낸다', () => {
  const data = {
    streak: { top: 21, users: [1300, 2303] },
    scenarios: { top: 120, users: [473] },
  };
  assert.deepEqual(recordsFromResponse(data), data);
  // 아무도 이어가지 않으면 0일에 빈 목록
  assert.deepEqual(
    recordsFromResponse({ ...data, streak: { top: 0, users: [] } }).streak,
    { top: 0, users: [] },
  );
});

test('모양이 다르면 던진다 — 호출부가 줄을 숨긴다', () => {
  assert.throws(() => recordsFromResponse(null), /모양이 다름/);
  assert.throws(
    () => recordsFromResponse({ streak: { top: '21', users: [] } }),
    /모양이 다름/,
  );
  assert.throws(
    () =>
      recordsFromResponse({
        streak: { top: 1, users: ['a'] },
        scenarios: { top: 1, users: [1] },
      }),
    /모양이 다름/,
  );
});
