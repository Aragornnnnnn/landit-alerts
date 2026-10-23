// 이상 징후 계약·경계값·출력 범위와 사용자 입력 처리를 실제 발송 없이 검증한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReferralRiskEmbed, parseReferralRisk } from './risk.mjs';

export const riskPayload = (record = {}) => ({
  type: 'REFERRAL_RISK', schema: 'landit_alerts', table: 'referral_risk_event',
  record: {
    id: '1', rule_code: 'INVITE_BURST', inviter_id: '100', inviter_nickname: '민수',
    detected_at: '2026-10-23T14:00:00+09:00', window_minutes: 10,
    observed_count: 3, matched_count: 3, min_count: 3, threshold_percent: null,
    evidence_referral_ids: ['10','11','12'], ...record,
  },
});

test('초대 급증은 닉네임·ID·관측값·기준·근거를 표시하고 확정 판단과 구분한다', () => {
  const record = parseReferralRisk(riskPayload({ email: 'private@example.com' }));
  const card = buildReferralRiskEmbed(record);
  assert.equal(card.fields[0].value, '민수 · user 100');
  assert.equal(card.fields[3].value, '등록 3명 / 3명 이상');
  assert.match(card.description, /어뷰징 확정이 아니며/);
  assert.match(card.footer.text, /자동 차단·보상 보류 없음/);
  assert.ok(!JSON.stringify(card).includes('private@example.com'));
  assert.equal(parseReferralRisk({ ...riskPayload(), schema: 'public' }), null);
  assert.equal(parseReferralRisk({ ...riskPayload(), type: 'INSERT' }), null);
});

test('50% 경계는 포함하며 최소 표본과 분모를 검증한다', () => {
  const refund = { rule_code: 'REFUND_RATIO', window_minutes: 10080,
    observed_count: 6, matched_count: 3, min_count: 5, threshold_percent: 50 };
  const card = buildReferralRiskEmbed(parseReferralRisk(riskPayload(refund)));
  assert.match(card.fields[3].value, /6건 중 현재 환불 3건 \(50.0%\)/);
  for (const change of [
    { matched_count: 2 }, { observed_count: 4 }, { matched_count: 7 },
    { threshold_percent: null }, { threshold_percent: 101 },
  ]) assert.equal(parseReferralRisk(riskPayload({ ...refund, ...change })), null);
});

test('임의 규칙·위험한 식별자·시간·수치·과도한 근거 목록은 거부한다', () => {
  for (const change of [
    { rule_code: 'toString' }, { inviter_id: '@everyone' }, { id: '0' },
    { detected_at: '2026-10-23' }, { observed_count: '3' }, { min_count: 0 },
    { observed_count: Number.MAX_SAFE_INTEGER+1 }, { window_minutes: 10081 },
    { matched_count: 1 }, { threshold_percent: 50 }, { evidence_referral_ids: [] },
    { evidence_referral_ids: ['bad'] }, { evidence_referral_ids: Array(11).fill('1') },
  ]) assert.equal(parseReferralRisk(riskPayload(change)), null);
  const record = parseReferralRisk(riskPayload({ inviter_nickname: '@everyone\n**x**' }));
  assert.equal(record.inviter_nickname, '＠everyone \\*\\*x\\*\\*');
});
