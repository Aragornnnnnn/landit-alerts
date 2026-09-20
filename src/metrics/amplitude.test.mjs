// 앰플리튜드 응답을 지표 숫자로 옮기는 순수 함수 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bucketsByFrequency,
  campaignsFromSeries,
  countByFrequency,
  singleValue,
  sumSeries,
} from './amplitude.mjs';

test('세그먼트 하나짜리 응답에서 값 하나를 꺼낸다', () => {
  assert.equal(singleValue({ seriesLabels: [0], series: [[137]] }), 137);
  assert.equal(
    singleValue({ seriesLabels: [''], series: [[230557.375]] }),
    230557.375,
  );
});

test('빈 응답은 0으로 본다', () => {
  assert.equal(singleValue({ seriesLabels: [], series: [] }), 0);
});

test('여러 날짜 열이 오면 전부 더한다', () => {
  assert.equal(sumSeries({ series: [[3, 4, 5]] }), 12);
});

test('frequency 버킷 라벨을 1개부터 차례로 세고, 상한 너머는 마지막 칸에 합친다', () => {
  const data = {
    seriesLabels: [
      [0, '1 time'],
      [0, '2 times'],
      [0, '4 times'],
      [0, '5 times'],
      [0, '6-10 times'],
    ],
    series: [[2], [3], [22], [1], [1]],
  };
  // 최대 4개 — 5 times·6-10 times는 4개 칸에 합친다
  assert.deepEqual(countByFrequency(data, 4), [2, 3, 0, 24]);
});

test('frequency 라벨이 없으면 전부 0이다', () => {
  assert.deepEqual(
    countByFrequency({ seriesLabels: [], series: [] }, 4),
    [0, 0, 0, 0],
  );
});

test('entry_campaign 그룹에서 (none)은 버리고 위젯과 알림 캠페인을 가른다', () => {
  const data = {
    seriesLabels: [
      [0, '(none)'],
      [0, 'streak_widget'],
      [0, 'daily_scenario_reminder'],
      [0, 'mailbox_reply'],
    ],
    series: [[134], [13], [6], [3]],
  };
  assert.deepEqual(campaignsFromSeries(data), {
    widget: 13,
    notificationByCampaign: { daily_scenario_reminder: 6, mailbox_reply: 3 },
  });
});

test('frequency 버킷을 앰플리튜드 구간 그대로 한글 라벨로 옮긴다', () => {
  const data = {
    seriesLabels: [
      [0, '1 time'],
      [0, '2 times'],
      [0, '6-10 times'],
      [0, '11-20 times'],
    ],
    series: [[179], [70], [14], [1]],
  };
  assert.deepEqual(bucketsByFrequency(data), [
    ['1개', 179],
    ['2개', 70],
    ['6~10개', 14],
    ['11~20개', 1],
  ]);
});
