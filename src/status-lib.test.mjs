// 서드파티 상태 알림 순수 로직(지표 분류·변화 감지·embed 생성) 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TARGETS,
  buildStatusEmbed,
  classifyIndicator,
  diffStatusChanges,
  nextLevels,
} from './status-lib.mjs';

test('Statuspage 지표를 정상·경미·심각 세 단계로 눕힌다', () => {
  assert.equal(classifyIndicator('none'), 'ok');
  assert.equal(classifyIndicator('minor'), 'minor');
  assert.equal(classifyIndicator('major'), 'major');
  assert.equal(classifyIndicator('critical'), 'major');
});

test('모르는 지표는 판단을 미룬다', () => {
  assert.equal(classifyIndicator('maintenance'), 'unknown');
  assert.equal(classifyIndicator(undefined), 'unknown');
});

test('레벨이 바뀐 대상만 골라낸다', () => {
  // given — 버셀만 정상에서 심각으로 바뀌었다
  const previous = { vercel: 'ok', sentry: 'ok' };
  const current = [
    { key: 'vercel', level: 'major', description: 'Major Outage' },
    { key: 'sentry', level: 'ok', description: 'All Systems Operational' },
  ];

  const changes = diffStatusChanges(previous, current);

  assert.deepEqual(
    changes.map((c) => [c.key, c.from, c.to]),
    [['vercel', 'ok', 'major']],
  );
});

test('처음 보는 대상은 정상을 기준으로 삼아, 장애일 때만 알린다', () => {
  // given — 등록부에 갓 추가돼 이전 레벨이 없다
  const current = [
    { key: 'expo', level: 'ok', description: '' },
    { key: 'deepgram', level: 'minor', description: 'Degraded' },
  ];

  const changes = diffStatusChanges({}, current);

  assert.deepEqual(
    changes.map((c) => c.key),
    ['deepgram'],
  );
});

test('악화되면 한 번 더 알린다', () => {
  const changes = diffStatusChanges({ supabase: 'minor' }, [
    { key: 'supabase', level: 'major', description: '' },
  ]);

  assert.deepEqual(
    changes.map((c) => [c.from, c.to]),
    [['minor', 'major']],
  );
});

test('상태를 못 읽었으면 변화로 치지 않는다', () => {
  // given — 우리 쪽 네트워크나 러너 문제로 수집에 실패했다
  const changes = diffStatusChanges({ github: 'ok' }, [
    { key: 'github', level: 'unknown', description: '' },
  ]);

  assert.deepEqual(changes, []);
});

test('상태를 못 읽은 대상은 이전 레벨을 그대로 물려받는다', () => {
  const levels = nextLevels({ github: 'major', vercel: 'ok' }, [
    { key: 'github', level: 'unknown', description: '' },
    { key: 'vercel', level: 'minor', description: '' },
  ]);

  assert.deepEqual(levels, { github: 'major', vercel: 'minor' });
});

test('복구 카드와 장애 카드는 색이 다르다', () => {
  const target = { key: 'vercel', name: 'Vercel', page: 'https://x' };
  const down = buildStatusEmbed(target, {
    from: 'ok',
    to: 'major',
    description: 'Major Outage',
  });
  const back = buildStatusEmbed(target, {
    from: 'major',
    to: 'ok',
    description: 'All Systems Operational',
  });

  assert.notEqual(down.color, back.color);
  assert.notEqual(down.author.icon_url, back.author.icon_url);
  assert.equal(down.title, 'Vercel');
  assert.equal(down.author.name, '장애');
  assert.equal(back.author.name, '정상 복구');
  assert.equal(down.url, 'https://x');
});

test('카드에 확인한 주소와 그 응답을 함께 싣는다', () => {
  const embed = buildStatusEmbed(
    { key: 'openrouter', name: 'OpenRouter', page: 'https://x' },
    {
      from: 'ok',
      to: 'major',
      description: '주소가 정상 응답하지 않습니다.',
      checkUrl: 'https://openrouter.ai/api/v1/models',
      response: 'HTTP 503',
    },
  );

  assert.match(embed.description, /openrouter\.ai\/api\/v1\/models/);
  assert.match(embed.description, /HTTP 503/);
});

test('감시 대상은 키가 겹치지 않고 종류가 둘 중 하나다', () => {
  const keys = TARGETS.map((t) => t.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(TARGETS.every((t) => ['statuspage', 'ping'].includes(t.type)));
});
