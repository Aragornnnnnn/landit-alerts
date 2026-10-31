// 설문 알림의 순수 로직 — 슈퍼베이스 웹훅 payload 해석, 질문·답변 형식 embed 생성
// 문항 목록은 landit-fe의 features/survey/model/questions.ts·paid-questions.ts와 같은 순서·id로 맞춘다

const OTHER_OPTION = '기타';
const otherKey = (id) => `${id}_other`;

// 화면 제목의 줄바꿈은 embed 필드 이름에선 한 줄로 편다
const GENERAL_QUESTIONS = [
  { id: 'channel', title: '랜딧을 어떻게 알게 되셨나요?' },
  { id: 'study_purpose', title: '영어 공부는 어떤 목적으로 하세요?' },
  { id: 'study_abroad_prep', title: '유학 준비는 어떻게 하고 계세요?' },
  { id: 'features', title: '랜딧에서 주로 어떤 기능을 쓰세요?' },
  { id: 'usage_time', title: '주로 언제 랜딧을 쓰세요?' },
  { id: 'satisfaction', title: '랜딧, 전반적으로 어떠셨나요?', scale: true },
  { id: 'satisfaction_reason', title: '그렇게 느끼신 이유를 알려주세요' },
  {
    id: 'monthly_price_limit',
    title: '랜딧은 월 얼마부터 적정하다고 느끼세요?',
  },
  {
    id: 'recommend_intent',
    title: '랜딧을 주변에 추천할 마음이 있으세요?',
    scale: true,
  },
  { id: 'has_recommended', title: '실제로 주변에 소개한 적이 있으세요?' },
  { id: 'wish', title: '마지막으로 랜딧에 바라는 점을 남겨주세요' },
];

const PAID_QUESTIONS = [
  {
    id: 'premium_reason',
    title: '어떤 이유로 프리미엄을 결제하시게 되었나요?',
  },
  { id: 'liked_features', title: '써 보니 어떤 기능이 가장 만족스러우세요?' },
  { id: 'wish', title: '더 있었으면 하는 기능이 있나요?' },
  { id: 'disappointment', title: '아쉬웠던 점을 알려주세요' },
  { id: 'channel', title: '랜딧을 어떻게 알게 되셨나요?' },
];

// survey 칸이 없던 때의 행은 일반 설문이다
const SURVEYS = {
  general: { title: '📝 새 설문 응답', questions: GENERAL_QUESTIONS },
  paid: { title: '💳 결제자 설문 응답', questions: PAID_QUESTIONS },
};

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
  if (typeof value === 'number') return `${value}점`;
  return withOther(answers, question.id, value);
};

// 필드 사이에 빈 줄을 두려고 값 끝에 공백 문자 줄을 붙인다 — 디스코드는 필드 간격 옵션이 없다
const SPACER = '\n\u200b';

// 답하지 않은 문항(조건부로 건너뛴 것)은 필드를 만들지 않는다
export const buildSurveyEmbed = ({
  survey,
  user_id,
  email,
  answers,
  created_at,
}) => {
  const { title, questions } = SURVEYS[survey] ?? SURVEYS.general;
  const answered = questions.filter((q) => q.id in answers);
  const fields = answered.map((q, i) => ({
    // 점수 문항은 질문 뒤에 범위를 붙인다 — 답은 "4점"처럼 짧게
    name: q.scale ? `${q.title} (1~5)` : q.title,
    value:
      (formatAnswer(q, answers).slice(0, MAX_FIELD_LENGTH - SPACER.length) ||
        '—') + (i < answered.length - 1 ? SPACER : ''),
  }));
  return {
    title,
    description: `${email ?? '이메일 없음'} · user ${user_id}`,
    fields,
    color: SURVEY_COLOR,
    timestamp: new Date(created_at).toISOString(),
  };
};

// 화면은 문항을 넘길 때마다 같은 행을 덮어쓰고(completed=false) 다 내면 completed=true로 마친다.
// 그래서 완료된 순간에 한 번만 보낸다 — 한 번에 낸 INSERT, 또는 완료로 바뀐 UPDATE.
// completed 칸이 없던 때의 행은 언제나 다 낸 응답이다.
const isCompletedNow = ({ type, record, old_record }) => {
  if (type === 'INSERT') return record.completed !== false;
  if (type === 'UPDATE')
    return record.completed === true && old_record?.completed === false;
  return false;
};

// 슈퍼베이스 Database Webhook payload에서 방금 완료된 응답 행만 꺼낸다. 아니면 null
export const parseSurveyWebhook = (payload) =>
  payload?.table === 'survey_responses' &&
  payload.record?.answers &&
  isCompletedNow(payload)
    ? payload.record
    : null;
