// 설문 알림의 순수 로직 — 슈퍼베이스 웹훅 payload 해석, 질문·답변 형식 embed 생성
// 문항 목록은 landit-fe의 features/survey/model/questions.ts와 같은 순서·id로 맞춘다

const OTHER_OPTION = '기타';
const otherKey = (id) => `${id}_other`;

// 화면 제목의 줄바꿈은 embed 필드 이름에선 한 줄로 편다
const QUESTIONS = [
  { id: 'channel', title: '랜딧을 어떻게 알게 되셨나요?' },
  { id: 'study_purpose', title: '영어 공부는 어떤 목적으로 하세요?' },
  { id: 'study_abroad_prep', title: '유학 준비는 어떻게 하고 계세요?' },
  { id: 'features', title: '랜딧에서 주로 어떤 기능을 쓰세요?' },
  { id: 'usage_time', title: '주로 언제 랜딧을 쓰세요?' },
  {
    id: 'satisfaction',
    title: '랜딧, 전반적으로 어떠셨나요?',
    scale: ['아쉬웠어요', '아주 만족했어요'],
  },
  { id: 'satisfaction_reason', title: '그렇게 느끼신 이유를 알려주세요' },
  {
    id: 'monthly_price_limit',
    title: '랜딧은 월 얼마부터 적정하다고 느끼세요?',
  },
  {
    id: 'recommend_intent',
    title: '랜딧을 주변에 추천할 마음이 있으세요?',
    scale: ['전혀 없어요', '아주 많아요'],
  },
  { id: 'has_recommended', title: '실제로 주변에 소개한 적이 있으세요?' },
  { id: 'wish', title: '마지막으로 랜딧에 바라는 점을 남겨주세요' },
];

const SURVEY_COLOR = 0x1abc9c;
// embed 필드 값 상한 — 넘으면 디스코드가 통째로 거절한다
const MAX_FIELD_LENGTH = 1024;

// 기타를 고른 답은 직접 쓴 내용으로 바꿔 보여준다
const withOther = (answers, id, option) =>
  option === OTHER_OPTION ? `기타 — ${answers[otherKey(id)] ?? ''}` : option;

const formatAnswer = (question, answers) => {
  const value = answers[question.id];
  if (Array.isArray(value)) {
    return value
      .map((v) => `• ${withOther(answers, question.id, v)}`)
      .join('\n');
  }
  if (typeof value === 'number') {
    const [low, high] = question.scale ?? [];
    return question.scale ? `${value} / 5  (1 ${low} · 5 ${high})` : `${value}`;
  }
  return withOther(answers, question.id, value);
};

// 답하지 않은 문항(조건부로 건너뛴 것)은 필드를 만들지 않는다
export const buildSurveyEmbed = ({ user_id, email, answers, created_at }) => {
  const fields = QUESTIONS.filter((q) => q.id in answers).map((q) => ({
    name: q.title,
    value: formatAnswer(q, answers).slice(0, MAX_FIELD_LENGTH) || '—',
  }));
  return {
    title: '📝 새 설문 응답',
    description: `${email ?? '이메일 없음'} · user ${user_id}`,
    fields,
    color: SURVEY_COLOR,
    timestamp: new Date(created_at).toISOString(),
  };
};

// 슈퍼베이스 Database Webhook payload에서 새 응답 행만 꺼낸다. 다른 이벤트·테이블이면 null
export const parseSurveyWebhook = (payload) =>
  payload?.type === 'INSERT' &&
  payload.table === 'survey_responses' &&
  payload.record?.answers
    ? payload.record
    : null;
