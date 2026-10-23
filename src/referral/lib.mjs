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

  // 구버전 트리거의 ID 전용 payload도 계속 받는다. 이메일·초대 코드·보상액은 제외한다.
  return {
    id: String(row.id),
    inviter_id: String(row.inviter_id),
    invitee_id: String(row.invitee_id),
    inviter_nickname: nicknameText(row.inviter_nickname),
    invitee_nickname: nicknameText(row.invitee_nickname),
    registered_at: new Date(row.registered_at).toISOString(),
  };
};

const nicknameText = (value) => {
  if (typeof value !== 'string') return null;
  // 줄바꿈·제어 문자로 다른 필드를 흉내 내거나 멘션·마크다운을 삽입하지 못하게 한다.
  const plain = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  return Array.from(plain)
    .slice(0, 100)
    .join('')
    .replace(/@/g, '＠')
    .replace(/[\\`*_~|<>\[\]()]/g, '\\$&');
};

const participant = (id, nickname) =>
  nickname ? `${nickname} · user ${id}` : `닉네임 미확인 · user ${id}`;

export const buildReferralEmbed = (record) => ({
  title: '🎉 친구 초대 등록',
  description: '신규 회원이 온보딩에서 초대 코드를 등록했습니다.',
  color: 0x2ecc71,
  fields: [
    {
      name: '초대인',
      value: participant(record.inviter_id, record.inviter_nickname),
      inline: true,
    },
    {
      name: '신규 회원',
      value: participant(record.invitee_id, record.invitee_nickname),
      inline: true,
    },
  ],
  footer: { text: `referral ${record.id} · 보상 지급 여부와 별개인 등록 알림` },
  timestamp: record.registered_at,
});
