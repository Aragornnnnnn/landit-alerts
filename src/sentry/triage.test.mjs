// landit-triage에 보낼 분석 요청을 만드는 로직의 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildTriageDispatch, issueIdOf } from './triage.mjs';

const message = { id: '111', channel_id: '222' };

test('이벤트의 issue_id로 이슈를 찾는다', () => {
  assert.equal(issueIdOf({ issue_id: '7773966015' }), '7773966015');
});

test('issue_id가 없으면 web_url에서 이슈 번호를 꺼낸다', () => {
  const event = {
    web_url: 'https://saynow.sentry.io/issues/7773990352/events/8aca604a/',
  };

  assert.equal(issueIdOf(event), '7773990352');
});

test('이슈를 알 수 없으면 null', () => {
  assert.equal(issueIdOf({ web_url: 'https://example.com' }), null);
});

test('카드 메시지 위치와 이슈·이벤트 id를 담은 dispatch 본문을 만든다', () => {
  // Given 이슈 알림 이벤트와 올라간 카드 메시지
  const event = { issue_id: '7773966015', event_id: 'c60fd1d7' };

  // When 분석 요청을 만들면
  const dispatch = buildTriageDispatch(event, message);

  // Then landit-triage 워크플로우가 읽는 형식이다
  assert.deepEqual(dispatch, {
    event_type: 'sentry-issue',
    client_payload: {
      issue_id: '7773966015',
      event_id: 'c60fd1d7',
      channel_id: '222',
      message_id: '111',
    },
  });
});

test('이슈를 알 수 없으면 요청을 만들지 않는다', () => {
  assert.equal(buildTriageDispatch({}, message), null);
});
