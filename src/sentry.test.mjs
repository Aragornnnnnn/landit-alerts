// Sentry 알림 순수 로직(웹훅 해석·서명 검증·embed 생성) 테스트
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import {
  buildSentryEmbed,
  isValidSentrySignature,
  parseSentryWebhook,
  resolveSentryChannel,
} from './sentry.mjs';

const event = (overrides = {}) => ({
  project: 12,
  title: 'ReferenceError: heck is not defined',
  level: 'error',
  culprit: 'app/page.tsx in onClick',
  environment: 'production',
  release: 'v1.4.0',
  web_url: 'https://sentry.io/organizations/landit/issues/1/events/abc/',
  timestamp: 1566248777.677,
  tags: [
    ['browser', 'Chrome 75'],
    ['os', 'iOS 18.6'],
    ['url', 'https://landit.im/home'],
  ],
  user: { id: '42' },
  ...overrides,
});

const sign = (secret, body) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex');

test('event_alert 리소스의 payload에서 이벤트와 규칙 이름을 꺼낸다', () => {
  const payload = {
    action: 'triggered',
    data: { event: event(), triggered_rule: '새 이슈' },
  };

  assert.deepEqual(parseSentryWebhook('event_alert', payload), {
    event: event(),
    rule: '새 이슈',
  });
});

test('event_alert가 아닌 리소스(설치·이슈 변경)는 null을 돌려준다', () => {
  assert.equal(
    parseSentryWebhook('installation', { action: 'created', data: {} }),
    null,
  );
  assert.equal(parseSentryWebhook('event_alert', { data: {} }), null);
});

test('서명은 raw body의 HMAC-SHA256과 맞으면 통과한다', () => {
  const body = '{"a":1}';

  assert.equal(
    isValidSentrySignature('s3cret', body, sign('s3cret', body)),
    true,
  );
  assert.equal(
    isValidSentrySignature('s3cret', body, sign('other', body)),
    false,
  );
  assert.equal(isValidSentrySignature('s3cret', body, undefined), false);
  assert.equal(isValidSentrySignature(undefined, body, sign('', body)), false);
});

test('Sentry가 다시 직렬화한 JSON으로 서명했어도 통과한다', () => {
  // given — 원문엔 공백이 있지만 서명은 JSON.stringify 결과로 계산됐다
  const raw = '{ "a": 1 }';
  const signature = sign('s3cret', JSON.stringify(JSON.parse(raw)));

  assert.equal(isValidSentrySignature('s3cret', raw, signature), true);
});

test('프로젝트 id로 디스코드 웹훅을 고르고 모르는 프로젝트면 null이다', () => {
  const channels = JSON.stringify({ 12: 'https://discord/web' });

  assert.equal(resolveSentryChannel(channels, 12), 'https://discord/web');
  assert.equal(resolveSentryChannel(channels, 99), null);
  assert.equal(resolveSentryChannel(undefined, 12), null);
});

test('에러는 빨간 카드에 제목·링크·환경·릴리즈·브라우저·OS를 담는다', () => {
  const embed = buildSentryEmbed(event(), '새 이슈');

  assert.equal(embed.title, '🔴 ReferenceError: heck is not defined');
  assert.equal(embed.url, event().web_url);
  assert.equal(embed.description, 'app/page.tsx in onClick');
  assert.equal(embed.color, 0xe74c3c);
  assert.deepEqual(embed.fields, [
    { name: '환경', value: 'production', inline: true },
    { name: '릴리즈', value: 'v1.4.0', inline: true },
    { name: '사용자', value: '42', inline: true },
    { name: '브라우저', value: 'Chrome 75', inline: true },
    { name: 'OS', value: 'iOS 18.6', inline: true },
    { name: 'URL', value: 'https://landit.im/home', inline: false },
  ]);
  assert.equal(embed.footer.text, '규칙 · 새 이슈');
  assert.equal(embed.timestamp, '2019-08-19T21:06:17.677Z');
});

test('경고는 노란색, 정보는 파란색이고 없는 정보는 필드를 만들지 않는다', () => {
  const warning = buildSentryEmbed(
    event({ level: 'warning', release: null, tags: [], user: undefined }),
    '규칙',
  );
  const info = buildSentryEmbed(event({ level: 'info' }), '규칙');

  assert.equal(warning.title, '🟡 ReferenceError: heck is not defined');
  assert.equal(warning.color, 0xf1c40f);
  assert.deepEqual(warning.fields, [
    { name: '환경', value: 'production', inline: true },
  ]);
  assert.equal(info.title, '🔵 ReferenceError: heck is not defined');
  assert.equal(info.color, 0x3498db);
});

test('사용자는 이메일이 있으면 이메일을, 없으면 id를 쓴다', () => {
  const withEmail = buildSentryEmbed(
    event({ user: { id: '42', email: 'a@b.com' } }),
    '규칙',
  );

  assert.equal(withEmail.fields[2].value, 'a@b.com');
});

test('긴 제목과 culprit은 디스코드 상한에 맞춰 자른다', () => {
  const embed = buildSentryEmbed(
    event({ title: 'x'.repeat(300), culprit: 'y'.repeat(5000) }),
    '규칙',
  );

  assert.equal(embed.title.length, 256);
  assert.equal(embed.description.length, 4096);
});
