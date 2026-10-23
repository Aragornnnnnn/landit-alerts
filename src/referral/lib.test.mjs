// 레퍼럴 이벤트 범위·시간대·식별자 검증과 디스코드 카드의 개인정보 범위를 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildReferralEmbed, parseReferralWebhook } from './lib.mjs';

const payload = (record = {}) => ({
  type: 'INSERT',
  schema: 'public',
  table: 'referral',
  record: {
    id: '12',
    inviter_id: '100',
    invitee_id: '200',
    inviter_nickname: '민수',
    invitee_nickname: '지은',
    registered_at: '2026-10-23T09:30:00+09:00',
    ...record,
  },
});

test('초대 등록 시각의 시간대를 보존하고 알림에 필요한 필드만 꺼낸다', () => {
  const record = parseReferralWebhook(payload({ email: 'private@example.com' }));
  assert.deepEqual(record, {
    id: '12',
    inviter_id: '100',
    invitee_id: '200',
    inviter_nickname: '민수',
    invitee_nickname: '지은',
    registered_at: '2026-10-23T00:30:00.000Z',
  });
  const embed = buildReferralEmbed(record);
  assert.equal(embed.fields[0].value, '민수 · user 100');
  assert.equal(embed.fields[1].value, '지은 · user 200');
  assert.equal(embed.timestamp, record.registered_at);
  assert.match(embed.footer.text, /referral 12/);
  assert.ok(!JSON.stringify(embed).includes('private@example.com'));
});

test('구버전 payload와 비어 있거나 잘못된 닉네임도 ID 알림을 유지한다', () => {
  for (const value of [undefined, null, '', ' \n ', 123, {}, []]) {
    const record = parseReferralWebhook(payload({ inviter_nickname: value }));
    assert.equal(buildReferralEmbed(record).fields[0].value, '닉네임 미확인 · user 100');
    assert.equal(buildReferralEmbed(record).fields[1].value, '지은 · user 200');
  }
});

test('닉네임의 멘션·마크다운·제어 문자를 무력화하고 길이를 제한한다', () => {
  const record = parseReferralWebhook(payload({
    inviter_nickname: '**민수**\n<@123> @everyone\u202e',
    invitee_nickname: '😀'.repeat(1000),
  }));
  assert.equal(record.inviter_nickname, '\\*\\*민수\\*\\* \\<＠123\\> ＠everyone');
  assert.equal(record.invitee_nickname, '😀'.repeat(100));
  assert.ok(buildReferralEmbed(record).fields.every(({ value }) => value.length <= 1024));
});

test('다른 테이블·스키마와 UPDATE·DELETE는 등록으로 처리하지 않는다', () => {
  for (const change of [
    { type: 'UPDATE' },
    { type: 'DELETE' },
    { table: 'user_profile' },
    { schema: 'private' },
  ])
    assert.equal(parseReferralWebhook({ ...payload(), ...change }), null);
  assert.equal(parseReferralWebhook(null), null);
});

test('잘못된 ID·자기 초대·시간대 없는 시각은 전송하지 않는다', () => {
  for (const change of [
    { id: 0 },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { id: '9223372036854775808' },
    { inviter_id: '@everyone' },
    { invitee_id: null },
    { invitee_id: 100 },
    { registered_at: '2026-10-23T09:30:00' },
    { registered_at: 'invalid' },
  ])
    assert.equal(parseReferralWebhook(payload(change)), null);
  assert.equal(parseReferralWebhook({ ...payload(), record: null }), null);
});

test('안전한 숫자 ID와 PostgreSQL bigint 문자열을 지원한다', () => {
  assert.equal(parseReferralWebhook(payload({ id: 12 })).id, '12');
  assert.equal(
    parseReferralWebhook(payload({ id: '9223372036854775807' })).id,
    '9223372036854775807',
  );
});
