// 플레이 기기 모델 코드 → 마케팅 이름 변환 로직 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deviceLabel, parseDeviceNames } from './play.mjs';

const CSV = [
  'Retail Branding,Marketing Name,Device,Model',
  'Samsung,Galaxy S24+,e2q,SM-S926N',
  '"LG",\"G Pad 8.0, LTE\",altev2,LG-V495',
  'Samsung,Galaxy S24+ 중복,e2q,SM-S926N',
].join('\n');

test('CSV에서 모델 코드로 마케팅 이름을 찾는다', () => {
  const names = parseDeviceNames(CSV);

  assert.equal(deviceLabel(names, 'SM-S926N'), 'Galaxy S24+');
});

test('코드명(Device 열)으로도 마케팅 이름을 찾는다', () => {
  const names = parseDeviceNames(CSV);

  assert.equal(deviceLabel(names, 'e2q'), 'Galaxy S24+');
});

test('따옴표로 감싼 쉼표 포함 이름을 온전히 읽는다', () => {
  const names = parseDeviceNames(CSV);

  assert.equal(deviceLabel(names, 'LG-V495'), 'G Pad 8.0, LTE');
});

test('같은 모델이 여러 줄이면 첫 항목을 쓴다', () => {
  const names = parseDeviceNames(CSV);

  assert.equal(deviceLabel(names, 'SM-S926N'), 'Galaxy S24+');
});

test('매핑에 없는 모델은 코드 그대로 돌려준다', () => {
  const names = parseDeviceNames(CSV);

  assert.equal(deviceLabel(names, 'UNKNOWN-1'), 'UNKNOWN-1');
});

test('기기 정보가 없으면 null을 유지한다', () => {
  const names = parseDeviceNames(CSV);

  assert.equal(deviceLabel(names, null), null);
});
