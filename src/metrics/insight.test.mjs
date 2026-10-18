// 분석 문구 요청 조립과 응답 해석 테스트 — 네트워크는 타지 않는다
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildInsightRequest,
  insightFromResponse,
  stripAnsi,
} from './insight.mjs';
import { buildDailyMessage } from './lib.mjs';
import { daily, previousDaily } from './sample.mjs';

test('ANSI 색 코드를 벗기면 사람이 읽는 본문만 남는다', () => {
  const text = stripAnsi(buildDailyMessage(daily, previousDaily));
  assert.doesNotMatch(text, /\x1b/);
  assert.ok(text.includes('👥 활성 123명 +9'));
});

test('요청에는 본문과 원본 숫자, 전일 값이 같이 들어가고 거절 대비가 켜져 있다', () => {
  const body = buildInsightRequest({
    messageText: '본문',
    current: daily,
    previous: previousDaily,
  });
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  const content = body.messages[0].content;
  assert.ok(content.startsWith('오늘 메시지:\n본문'));
  assert.ok(content.includes(JSON.stringify(daily)));
  assert.ok(content.includes(JSON.stringify(previousDaily)));
});

test('응답의 text 블록을 이어 붙이고, 거절이나 빈 응답은 던진다', () => {
  assert.equal(
    insightFromResponse({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '💡 하나\n💪 둘\n' },
      ],
    }),
    '💡 하나\n💪 둘',
  );
  assert.throws(
    () =>
      insightFromResponse({
        stop_reason: 'refusal',
        stop_details: { category: 'general_harms' },
        content: [],
      }),
    /분석 거절\(general_harms\)/,
  );
  assert.throws(() => insightFromResponse({ content: [] }), /비었어요/);
});

test('너무 길면 400자에서 말줄임으로 자른다', () => {
  const text = insightFromResponse({
    content: [{ type: 'text', text: 'x'.repeat(500) }],
  });
  assert.equal(text.length, 400);
  assert.ok(text.endsWith('…'));
});
