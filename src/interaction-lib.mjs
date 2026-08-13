// 답글 버튼 상호작용의 순수 로직 — custom_id 인코딩, 버튼·모달 페이로드 생성
const SEP = '|';

// 형식: "reply|appStore|<리뷰ID>" — 리뷰 ID에 콜론이 있어서 구분자는 파이프를 쓴다
export const encodeCustomId = (action, store, reviewId) =>
  [action, store, reviewId].join(SEP);

export const decodeCustomId = (customId) => {
  const [action, store, ...rest] = customId.split(SEP);
  return { action, store, reviewId: rest.join(SEP) };
};

// 리뷰 알림 메시지에 붙는 버튼 한 줄 (답글 전 → 초록 답글 달기, 답글 후 → 회색 수정)
// 색은 디스코드 고정 팔레트(파랑보라·회색·초록·빨강)만 가능해서 초록(3)을 쓴다
export const buildReplyButton = (store, reviewId, replied) => ({
  type: 1,
  components: [
    {
      type: 2,
      style: replied ? 2 : 3,
      label: replied ? '✏️ 답글 수정' : '✍️ 답글 달기',
      custom_id: encodeCustomId(replied ? 'edit' : 'reply', store, reviewId),
    },
  ],
});

// 답글 성공 기록 — 작성자를 굵은 필드 제목으로 올려 한눈에 보이게 한다 (수정 시 교체)
const REPLY_FIELD_PREFIX = '✅ 답글';

export const applyReplyToEmbed = (embed, replyText, authorName) => ({
  ...embed,
  fields: [
    ...(embed.fields ?? []).filter(
      (f) => !f.name.startsWith(REPLY_FIELD_PREFIX),
    ),
    { name: `${REPLY_FIELD_PREFIX} — ${authorName}`, value: replyText },
  ],
});

// 버튼을 누르면 열리는 답글 작성 모달 (수정이면 기존 답글을 프리필)
export const buildReplyModal = (store, reviewId, existingReply) => ({
  custom_id: encodeCustomId('submit', store, reviewId),
  title: store === 'appStore' ? 'App Store 리뷰 답글' : 'Play Store 리뷰 답글',
  components: [
    {
      type: 1,
      components: [
        {
          type: 4,
          custom_id: 'reply_body',
          style: 2,
          label: '답글 내용',
          min_length: 2,
          max_length: 350,
          required: true,
          ...(existingReply ? { value: existingReply } : {}),
        },
      ],
    },
  ],
});
