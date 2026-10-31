// 설문 알림 순수 로직(웹훅 해석·embed 생성) 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSurveyEmbed, parseSurveyWebhook } from './lib.mjs';

const row = (answers) => ({
  user_id: 7,
  email: 'a@b.com',
  answers,
  created_at: '2026-09-11T10:00:00Z',
});

test('문항 순서대로 질문·답변 필드를 만들고 안 답한 문항은 뺀다', () => {
  // given — 조건부 문항(study_abroad_prep, has_recommended)은 답이 없다
  const embed = buildSurveyEmbed(
    row({ wish: '더 많은 시나리오', channel: '지인 추천', satisfaction: 4 }),
  );

  assert.deepEqual(
    embed.fields.map((f) => f.name),
    [
      '랜딧을 어떻게 알게 되셨나요?',
      '랜딧, 전반적으로 어떠셨나요? (1~5)',
      '마지막으로 랜딧에 바라는 점을 남겨주세요',
    ],
  );
  assert.equal(embed.fields[0].value, '지인 추천\n\u200b');
  assert.equal(embed.description, 'a@b.com · user 7');
  assert.equal(embed.timestamp, '2026-09-11T10:00:00.000Z');
});

test('필드 사이에만 빈 줄을 넣고 마지막 필드 뒤에는 넣지 않는다', () => {
  const embed = buildSurveyEmbed(row({ channel: '지인 추천', wish: '없어요' }));

  assert.equal(embed.fields[0].value, '지인 추천\n\u200b');
  assert.equal(embed.fields[1].value, '없어요');
});

test('기타를 고르면 직접 쓴 내용으로 바꿔 보여준다', () => {
  const embed = buildSurveyEmbed(
    row({ channel: '기타', channel_other: '유튜브 영상' }),
  );

  assert.equal(embed.fields[0].value, '기타 — 유튜브 영상');
});

test('복수 선택은 한 줄에 하나씩 점을 찍어 나열한다', () => {
  const embed = buildSurveyEmbed(
    row({ features: ['시나리오 대화', '기타'], features_other: '발음' }),
  );

  assert.equal(embed.fields[0].value, '• 시나리오 대화\n• 기타 — 발음');
});

test('점수 문항은 질문 뒤에 범위를 붙이고 답은 n점으로 적는다', () => {
  const embed = buildSurveyEmbed(row({ recommend_intent: 2 }));

  assert.equal(
    embed.fields[0].name,
    '랜딧을 주변에 추천할 마음이 있으세요? (1~5)',
  );
  assert.equal(embed.fields[0].value, '2점');
});

test('빈 서술 답은 빈 필드 대신 줄표로 채운다', () => {
  const embed = buildSurveyEmbed(row({ wish: '' }));

  assert.equal(embed.fields[0].value, '—');
});

test('결제자 설문은 결제자 설문 문항으로 카드를 만든다', () => {
  const embed = buildSurveyEmbed({
    ...row({
      channel: '지인 추천',
      disappointment: '대화가 짧아요',
      premium_reason: '환급이 좋아서',
      wish: '단어장',
      liked_features: ['스몰톡'],
    }),
    survey: 'paid',
  });

  assert.equal(embed.title, '💳 결제자 설문 응답');
  assert.deepEqual(
    embed.fields.map((f) => f.name),
    [
      '어떤 이유로 프리미엄을 결제하시게 되었나요?',
      '써 보니 어떤 기능이 가장 만족스러우세요?',
      '더 있었으면 하는 기능이 있나요?',
      '아쉬웠던 점을 알려주세요',
      '랜딧을 어떻게 알게 되셨나요?',
    ],
  );
});

test('종류가 없는 행은 일반 설문으로 본다', () => {
  const embed = buildSurveyEmbed(row({ wish: '없어요' }));

  assert.equal(embed.title, '📝 새 설문 응답');
  assert.equal(
    embed.fields[0].name,
    '마지막으로 랜딧에 바라는 점을 남겨주세요',
  );
});

const hook = (type, record, old_record) => ({
  type,
  table: 'survey_responses',
  record,
  old_record,
});

test('한 번에 낸 응답은 INSERT 때 보낸다', () => {
  // 완료 칸이 생기기 전 행과, 응답 번호 없이 한 번에 낸 행(completed 기본값 true)
  const legacy = { user_id: 1, answers: { wish: 'x' } };
  const whole = { ...legacy, completed: true };

  assert.deepEqual(parseSurveyWebhook(hook('INSERT', legacy)), legacy);
  assert.deepEqual(parseSurveyWebhook(hook('INSERT', whole)), whole);
});

test('중간 저장으로 처음 들어온 행은 보내지 않는다', () => {
  const partial = {
    user_id: 1,
    completed: false,
    answers: { premium_reason: 'x' },
  };

  assert.equal(parseSurveyWebhook(hook('INSERT', partial)), null);
});

test('중간 저장하던 응답이 완료로 바뀌는 UPDATE에서 한 번만 보낸다', () => {
  const done = {
    user_id: 1,
    completed: true,
    answers: { premium_reason: 'x' },
  };

  assert.deepEqual(
    parseSurveyWebhook(hook('UPDATE', done, { completed: false })),
    done,
  );
  // 아직 진행 중인 덮어쓰기와, 이미 완료된 행의 재저장은 보내지 않는다
  assert.equal(
    parseSurveyWebhook(
      hook('UPDATE', { ...done, completed: false }, { completed: false }),
    ),
    null,
  );
  assert.equal(
    parseSurveyWebhook(hook('UPDATE', done, { completed: true })),
    null,
  );
});

test('다른 테이블이나 빈 payload는 응답으로 보지 않는다', () => {
  const record = { user_id: 1, answers: { wish: 'x' } };

  assert.equal(
    parseSurveyWebhook({ type: 'INSERT', table: 'letters', record }),
    null,
  );
  assert.equal(parseSurveyWebhook(null), null);
});
