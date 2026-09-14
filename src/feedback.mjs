// 편지함 피드백 알림의 순수 로직 — 슈퍼베이스 웹훅 payload 해석, 피드백 한 통을 embed로 만든다
// 유형 이름·이모지는 landit-fe의 features/mailbox/model/feedback-type.ts와 맞춘다

const FEEDBACK_TYPES = {
  BUG_REPORT: { emoji: '🐛', label: '문제 신고', color: 0xe74c3c },
  FEATURE_REQUEST: { emoji: '💡', label: '신규 기능 요청', color: 0x3498db },
  QUESTION: { emoji: '🙋', label: '궁금한 점 문의', color: 0xf1c40f },
  CHEER: { emoji: '🙌', label: '개발자 응원', color: 0x1abc9c },
};
// 모르는 유형이 와도 카드는 보낸다 — 유형이 늘어난 걸 알아채는 쪽이 낫다
const UNKNOWN_TYPE = { emoji: '✉️', label: '피드백', color: 0x95a5a6 };

// embed description 상한 — 넘으면 디스코드가 통째로 거절한다
const MAX_DESCRIPTION_LENGTH = 4096;

const truncate = (text) =>
  text.length > MAX_DESCRIPTION_LENGTH
    ? `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
    : text;

// 본문이 카드의 전부다. 누가 보냈는지는 footer에 id만 적는다 — 시각은 디스코드 메시지 시각으로 충분하다
export const buildFeedbackEmbed = ({
  id,
  user_profile_id,
  feedback_type,
  content_text,
}) => {
  const type = FEEDBACK_TYPES[feedback_type] ?? UNKNOWN_TYPE;
  return {
    title: `${type.emoji} ${type.label}`,
    description: truncate(content_text?.trim() || '(내용 없음)'),
    color: type.color,
    footer: { text: `user ${user_profile_id} · 피드백 #${id}` },
  };
};

// 슈퍼베이스 Database Webhook payload에서 새 피드백 행만 꺼낸다. 다른 이벤트·테이블이면 null
export const parseFeedbackWebhook = (payload) =>
  payload?.type === 'INSERT' &&
  payload.table === 'mailbox_feedback' &&
  payload.record?.id != null
    ? payload.record
    : null;
