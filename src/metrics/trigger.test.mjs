// 버셀 크론이 깃허브를 깨울 때 무엇을 돌릴지 고르는 로직 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { modesForToday } from './trigger.mjs';

test('평일엔 일일만, 월요일엔 주간까지 돌린다', () => {
  // 2026-09-21은 월요일
  assert.deepEqual(modesForToday('2026-09-21'), ['daily', 'weekly']);
  assert.deepEqual(modesForToday('2026-09-22'), ['daily']);
  assert.deepEqual(modesForToday('2026-09-20'), ['daily']);
});
