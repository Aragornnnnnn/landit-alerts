// 슈퍼베이스 스트릭 응답을 최고 스트릭으로 옮기는 순수 함수 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { topStreak } from './supabase.mjs';

test('내림차순 행에서 최고 스트릭과 그 값에 있는 사람 수를 센다', () => {
  assert.deepEqual(
    topStreak([
      { user_profile_id: 1300, current_streak_days: 21 },
      { user_profile_id: 2303, current_streak_days: 21 },
      { user_profile_id: 473, current_streak_days: 13 },
    ]),
    { top: 21, users: [1300, 2303] },
  );
});

test('아무도 없거나 전부 0이면 0일 0명', () => {
  assert.deepEqual(topStreak([]), { top: 0, users: [] });
  assert.deepEqual(
    topStreak([{ user_profile_id: 9, current_streak_days: 0 }]),
    { top: 0, users: [] },
  );
});
