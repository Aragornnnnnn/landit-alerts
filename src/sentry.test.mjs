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

test('event_alert 리소스의 payload에서 이벤트를 꺼낸다', () => {
  const payload = {
    action: 'triggered',
    data: { event: event(), triggered_rule: '새 이슈' },
  };

  assert.deepEqual(parseSentryWebhook('event_alert', payload), {
    event: event(),
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
  const embed = buildSentryEmbed(event());

  assert.equal(embed.title, '🔴 ReferenceError: heck is not defined');
  assert.equal(embed.url, event().web_url);
  assert.equal(embed.color, 0xe74c3c);
  assert.deepEqual(embed.fields, [
    { name: '환경', value: 'production', inline: true },
    { name: '릴리즈', value: 'v1.4.0', inline: true },
    { name: '사용자', value: '42', inline: true },
    { name: '브라우저', value: 'Chrome 75', inline: true },
    { name: 'OS', value: 'iOS 18.6', inline: true },
    { name: '요청', value: 'https://landit.im/home', inline: false },
    { name: '발생 위치', value: 'app/page.tsx in onClick', inline: false },
  ]);
  assert.equal(embed.timestamp, '2019-08-19T21:06:17.677Z');
});

test('예외·요청·기기·앱 버전·스택을 있으면 담는다', () => {
  const embed = buildSentryEmbed(
    event({
      title: 'Boom',
      contexts: {
        device: { model: 'iPhone 15 Pro' },
        app: { app_version: '1.3.0', app_build: '19' },
      },
      request: { method: 'GET', url: 'https://landit.im/api/x' },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'x is not a function',
            stacktrace: {
              frames: [
                {
                  function: 'main',
                  filename: 'vendor.js',
                  lineno: 1,
                  in_app: false,
                },
                {
                  function: 'a',
                  filename: 'app/a.tsx',
                  lineno: 10,
                  in_app: true,
                },
                {
                  function: 'b',
                  filename: 'app/b.tsx',
                  lineno: 20,
                  in_app: true,
                },
                {
                  function: 'c',
                  filename: 'app/c.tsx',
                  lineno: 30,
                  in_app: true,
                },
                {
                  function: 'd',
                  filename: 'app/d.tsx',
                  lineno: 40,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    }),
  );
  const byName = Object.fromEntries(embed.fields.map((f) => [f.name, f]));

  assert.equal(byName['기기'].value, 'iPhone 15 Pro');
  // 스택이 있으면 발생 위치는 중복이라 뺀다
  assert.equal('발생 위치' in byName, false);
  assert.equal(byName['앱 버전'].value, '1.3.0 (19)');
  assert.equal(byName['예외'].value, 'TypeError: x is not a function');
  assert.equal(byName['요청'].value, 'GET https://landit.im/api/x');
  assert.equal(byName['요청'].inline, false);
  // 앱 코드 프레임만, 최근 것부터 3개
  assert.equal(
    byName['호출 경로 (맨 위가 터진 곳)'].value,
    '```\nd  app/d.tsx:40\nc  app/c.tsx:30\nb  app/b.tsx:20\n```',
  );
});

test('예외가 제목과 같으면 예외 필드를 중복으로 만들지 않고, 요청이 없으면 url 태그를 쓴다', () => {
  const embed = buildSentryEmbed(
    event({
      title: 'TypeError: x',
      exception: { values: [{ type: 'TypeError', value: 'x' }] },
    }),
  );
  const names = embed.fields.map((f) => f.name);

  assert.equal(names.includes('예외'), false);
  assert.equal(
    embed.fields.find((f) => f.name === '요청').value,
    'https://landit.im/home',
  );
});

test('경고는 노란색, 정보는 파란색이고 없는 정보는 필드를 만들지 않는다', () => {
  const warning = buildSentryEmbed(
    event({ level: 'warning', release: null, tags: [], user: undefined }),
  );
  const info = buildSentryEmbed(event({ level: 'info' }));

  assert.equal(warning.title, '🟡 ReferenceError: heck is not defined');
  assert.equal(warning.color, 0xf1c40f);
  assert.deepEqual(warning.fields, [
    { name: '환경', value: 'production', inline: true },
    { name: '발생 위치', value: 'app/page.tsx in onClick', inline: false },
  ]);
  assert.equal(info.title, '🔵 ReferenceError: heck is not defined');
  assert.equal(info.color, 0x3498db);
});

test('사용자는 이메일이 있어도 id만 적는다', () => {
  const embed = buildSentryEmbed(
    event({ user: { id: '42', email: 'a@b.com' } }),
  );

  assert.equal(embed.fields.find((f) => f.name === '사용자').value, '42');
});

test('긴 제목은 디스코드 상한에 맞춰 자른다', () => {
  const embed = buildSentryEmbed(event({ title: 'x'.repeat(300) }));

  assert.equal(embed.title.length, 256);
});
