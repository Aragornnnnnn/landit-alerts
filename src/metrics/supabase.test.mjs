// 슈퍼베이스 응답을 최고 스트릭·시나리오 누적 최다로 옮기는 순수 함수 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { topScenarios, topStreak } from './supabase.mjs';

test('내림차순 행에서 최고 스트릭과 그 값에 있는 사람들의 id를 꺼낸다', () => {
  assert.deepEqual(
    topStreak([
      { user_profile_id: 1300, current_streak_days: 21 },
      { user_profile_id: 2303, current_streak_days: 21 },
      { user_profile_id: 473, current_streak_days: 13 },
    ]),
    { top: 21, users: [1300, 2303] },
  );
});

test('아무도 없거나 전부 0이면 0일에 빈 목록', () => {
  assert.deepEqual(topStreak([]), { top: 0, users: [] });
  assert.deepEqual(
    topStreak([{ user_profile_id: 9, current_streak_days: 0 }]),
    {
      top: 0,
      users: [],
    },
  );
});

test('서비스 전체 시나리오 누적 최다와 그 값에 있는 사람들의 id를 꺼낸다', () => {
  assert.deepEqual(
    topScenarios([
      { user_profile_id: 473, completed_scenario_count: 120 },
      { user_profile_id: 1300, completed_scenario_count: 45 },
    ]),
    { top: 120, users: [473] },
  );
  assert.deepEqual(topScenarios([]), { top: 0, users: [] });
});
