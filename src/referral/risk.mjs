// 초대 이상 징후의 집계 계약을 검증하고 운영 검토용 디스코드 카드를 만든다.
import { isId, isTimestamp, nicknameText } from './lib.mjs';

const labels = {
  INVITE_BURST: '단시간 초대 급증',
  INVITE_DAILY: '하루 초대 급증',
  REFUND_RATIO: '첫 결제 환불 집중',
};
const positive = (n, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(n) && n > 0 && n <= max;

export const isReferralRisk = (payload) =>
  payload?.type === 'REFERRAL_RISK' && payload.schema === 'landit_alerts' &&
  payload.table === 'referral_risk_event';

export const parseReferralRisk = (payload) => {
  if (!isReferralRisk(payload)) return null;
  const r = payload.record;
  if (!r || !Object.hasOwn(labels, r.rule_code) || !isId(r.id) || !isId(r.inviter_id) ||
      !isTimestamp(r.detected_at) || !positive(r.window_minutes, 10080) ||
      !positive(r.observed_count) || !positive(r.matched_count) ||
      r.matched_count > r.observed_count || !positive(r.min_count, 1000000) ||
      r.observed_count < r.min_count || !Array.isArray(r.evidence_referral_ids) ||
      r.evidence_referral_ids.length < 1 || r.evidence_referral_ids.length > 10 ||
      !r.evidence_referral_ids.every(isId)) return null;
  if (r.rule_code === 'REFUND_RATIO') {
    if (!positive(r.threshold_percent, 100) ||
        BigInt(r.matched_count) * 100n < BigInt(r.observed_count) * BigInt(r.threshold_percent)) return null;
  } else if (r.threshold_percent != null || r.matched_count !== r.observed_count) return null;
  return {
    id: String(r.id), rule_code: r.rule_code, inviter_id: String(r.inviter_id),
    inviter_nickname: nicknameText(r.inviter_nickname),
    detected_at: new Date(r.detected_at).toISOString(), window_minutes: r.window_minutes,
    observed_count: r.observed_count, matched_count: r.matched_count,
    min_count: r.min_count, threshold_percent: r.threshold_percent ?? null,
    evidence_referral_ids: r.evidence_referral_ids.map(String),
  };
};

export const buildReferralRiskEmbed = (r) => ({
  title: '⚠️ 친구 초대 이상 징후',
  description: '설정한 기준을 넘었습니다. 어뷰징 확정이 아니며 운영자 확인이 필요합니다.',
  color: 0xf39c12,
  fields: [
    { name: '초대인', value: `${r.inviter_nickname ?? '닉네임 미확인'} · user ${r.inviter_id}` },
    { name: '탐지 사유', value: labels[r.rule_code], inline: true },
    { name: '집계 기간', value: `최근 ${r.window_minutes.toLocaleString('ko-KR')}분`, inline: true },
    { name: '관측 / 설정 기준', value: r.rule_code === 'REFUND_RATIO'
      ? `첫 결제 ${r.observed_count}건 중 현재 환불 ${r.matched_count}건 (${(r.matched_count / r.observed_count * 100).toFixed(1)}%)\n최소 ${r.min_count}건 · 환불 ${r.threshold_percent}% 이상`
      : `등록 ${r.observed_count}명 / ${r.min_count}명 이상` },
    { name: '확인할 레퍼럴 ID (최근 최대 10건)', value: r.evidence_referral_ids.join(', ') },
  ],
  footer: { text: `risk ${r.id} · 자동 차단·보상 보류 없음` },
  timestamp: r.detected_at,
});
