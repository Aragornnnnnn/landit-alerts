// 설문 알림 순수 로직(웹훅 해석·embed 생성) 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSurveyEmbed, parseSurveyWebhook } from './survey.mjs';

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
      '랜딧, 전반적으로 어떠셨나요?',
      '마지막으로 랜딧에 바라는 점을 남겨주세요',
    ],
  );
  assert.equal(embed.fields[0].value, '지인 추천');
  assert.equal(embed.description, 'a@b.com · user 7');
  assert.equal(embed.timestamp, '2026-09-11T10:00:00.000Z');
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

test('점수 문항은 5점 만점과 양 끝 뜻을 함께 적는다', () => {
  const embed = buildSurveyEmbed(row({ recommend_intent: 2 }));

  assert.equal(embed.fields[0].value, '2 / 5  (1 전혀 없어요 · 5 아주 많아요)');
});

test('빈 서술 답은 빈 필드 대신 줄표로 채운다', () => {
  const embed = buildSurveyEmbed(row({ wish: '' }));

  assert.equal(embed.fields[0].value, '—');
});

test('survey_responses에 INSERT된 행만 응답으로 인정한다', () => {
  const record = { user_id: 1, answers: { wish: 'x' } };

  assert.deepEqual(
    parseSurveyWebhook({ type: 'INSERT', table: 'survey_responses', record }),
    record,
  );
  assert.equal(
    parseSurveyWebhook({ type: 'UPDATE', table: 'survey_responses', record }),
    null,
  );
  assert.equal(
    parseSurveyWebhook({ type: 'INSERT', table: 'letters', record }),
    null,
  );
  assert.equal(parseSurveyWebhook(null), null);
});
