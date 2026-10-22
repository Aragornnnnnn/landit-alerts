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
    registered_at: '2026-10-23T00:30:00.000Z',
  });
  const embed = buildReferralEmbed(record);
  assert.equal(embed.fields[0].value, 'user 100');
  assert.equal(embed.fields[1].value, 'user 200');
  assert.equal(embed.timestamp, record.registered_at);
  assert.match(embed.footer.text, /referral 12/);
  assert.ok(!JSON.stringify(embed).includes('private@example.com'));
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
