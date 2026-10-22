// 레퍼럴 등록 웹훅을 검증하고 초대인·신규 회원을 표시하는 디스코드 카드를 만든다.

const isId = (value) =>
  (Number.isSafeInteger(value) && value > 0) ||
  (typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n);

// registered_at은 BE의 TIMESTAMP WITH TIME ZONE이다. 시간대 없는 값은 추측하지 않는다.
const isTimestamp = (value) =>
  typeof value === 'string' &&
  /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));

export const isReferralInsert = (payload) =>
  payload?.type === 'INSERT' &&
  payload.schema === 'public' &&
  payload.table === 'referral';

export const parseReferralWebhook = (payload) => {
  if (!isReferralInsert(payload)) return null;
  const row = payload.record;
  if (
    !row ||
    ![row.id, row.inviter_id, row.invitee_id].every(isId) ||
    String(row.inviter_id) === String(row.invitee_id) ||
    !isTimestamp(row.registered_at)
  )
    return null;

  // 알림에 필요한 값만 전달한다. 이메일·닉네임·초대 코드·보상액은 조회하지 않는다.
  return {
    id: String(row.id),
    inviter_id: String(row.inviter_id),
    invitee_id: String(row.invitee_id),
    registered_at: new Date(row.registered_at).toISOString(),
  };
};

export const buildReferralEmbed = (record) => ({
  title: '🎉 친구 초대 등록',
  description: '신규 회원이 온보딩에서 초대 코드를 등록했습니다.',
  color: 0x2ecc71,
  fields: [
    { name: '초대인', value: `user ${record.inviter_id}`, inline: true },
    { name: '신규 회원', value: `user ${record.invitee_id}`, inline: true },
  ],
  footer: { text: `referral ${record.id} · 보상 지급 여부와 별개인 등록 알림` },
  timestamp: record.registered_at,
});
