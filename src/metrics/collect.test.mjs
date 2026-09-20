// 기간 계산 순수 함수 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compact, kstDate, lastWeekOf, yesterdayOf } from './collect.mjs';

test('KST 기준 날짜 문자열을 만든다 — UTC 자정 직전이면 KST는 이미 다음날이다', () => {
  assert.equal(kstDate(new Date('2026-09-20T23:30:00Z')), '2026-09-21');
  assert.equal(kstDate(new Date('2026-09-20T14:30:00Z')), '2026-09-20');
});

test('어제와 지난주 월~일을 계산한다', () => {
  assert.equal(yesterdayOf('2026-09-21'), '2026-09-20');
  // 월요일 기준 지난주
  assert.deepEqual(lastWeekOf('2026-09-21'), {
    start: '2026-09-14',
    end: '2026-09-20',
  });
  // 주중에 돌려도 직전 월~일
  assert.deepEqual(lastWeekOf('2026-09-24'), {
    start: '2026-09-14',
    end: '2026-09-20',
  });
});

test('앰플리튜드 날짜 형식은 하이픈이 없다', () => {
  assert.equal(compact('2026-09-20'), '20260920');
});
