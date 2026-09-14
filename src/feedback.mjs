// 편지함 피드백 알림의 순수 로직 — 슈퍼베이스 웹훅 payload 해석, 피드백 한 통을 embed로 만든다
// 유형 이름은 landit-fe의 features/mailbox/model/feedback-type.ts와 맞춘다. 아이콘은 토스페이스를 앱 이모지로 올린 것(scripts/upload-app-emoji.mjs)

const FEEDBACK_TYPES = {
  BUG_REPORT: { label: '문제 신고', emojiId: '', color: 0xe74c3c },
  FEATURE_REQUEST: { label: '신규 기능 요청', emojiId: '', color: 0x3498db },
  QUESTION: { label: '궁금한 점 문의', emojiId: '', color: 0xf1c40f },
  CHEER: { label: '개발자 응원', emojiId: '', color: 0x1abc9c },
};
// 모르는 유형이 와도 카드는 보낸다 — 유형이 늘어난 걸 알아채는 쪽이 낫다
const UNKNOWN_TYPE = { label: '피드백', emojiId: '', color: 0x95a5a6 };

const ADMIN_FEEDBACKS_URL = 'https://admin.landit.im/feedbacks';
// embed description 상한 — 넘으면 디스코드가 통째로 거절한다
const MAX_DESCRIPTION_LENGTH = 4096;

const adminLink = (id) =>
  `[어드민에서 보기](${ADMIN_FEEDBACKS_URL}?open=${id})`;

const truncate = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

// 본문이 카드의 전부다. 누가 보냈는지는 footer에 user id만 적고, 피드백 id는 링크에만 들어간다 — 시각은 디스코드 메시지 시각으로 충분하다
export const buildFeedbackEmbed = ({
  id,
  user_profile_id,
  feedback_type,
  content_text,
}) => {
  const type = FEEDBACK_TYPES[feedback_type] ?? UNKNOWN_TYPE;
  const link = `\n\n${adminLink(id)}`;
  return {
    author: {
      name: type.label,
      ...(type.emojiId && {
        icon_url: `https://cdn.discordapp.com/emojis/${type.emojiId}.png`,
      }),
    },
    description:
      truncate(
        content_text?.trim() || '(내용 없음)',
        MAX_DESCRIPTION_LENGTH - link.length,
      ) + link,
    color: type.color,
    footer: { text: `user ${user_profile_id}` },
  };
};

// 슈퍼베이스 Database Webhook payload에서 새 피드백 행만 꺼낸다. 다른 이벤트·테이블이면 null
export const parseFeedbackWebhook = (payload) =>
  payload?.type === 'INSERT' &&
  payload.table === 'mailbox_feedback' &&
  payload.record?.id != null
    ? payload.record
    : null;
