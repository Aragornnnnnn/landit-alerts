// 편지함 피드백 알림 순수 로직(웹훅 해석·embed 생성) 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildFeedbackEmbed, parseFeedbackWebhook } from './feedback.mjs';

const row = (overrides) => ({
  id: 34,
  user_profile_id: 12,
  feedback_type: 'BUG_REPORT',
  content_text: '발음 평가가 안 끝나요',
  processing_status: 'PENDING',
  ...overrides,
});

test('유형별 이모지·이름을 제목에, 본문을 설명에, 보낸 사람 id를 footer에 적는다', () => {
  const embed = buildFeedbackEmbed(row());

  assert.equal(embed.title, '🐛 문제 신고');
  assert.equal(embed.description, '발음 평가가 안 끝나요');
  assert.equal(embed.footer.text, 'user 12 · 피드백 #34');
  assert.equal(embed.color, 0xe74c3c);
});

test('네 유형의 이름은 앱 선택 화면과 같다', () => {
  const titles = ['BUG_REPORT', 'FEATURE_REQUEST', 'QUESTION', 'CHEER'].map(
    (feedback_type) => buildFeedbackEmbed(row({ feedback_type })).title,
  );

  assert.deepEqual(titles, [
    '🐛 문제 신고',
    '💡 신규 기능 요청',
    '🙋 궁금한 점 문의',
    '🙌 개발자 응원',
  ]);
});

test('모르는 유형이 와도 카드를 만든다', () => {
  const embed = buildFeedbackEmbed(row({ feedback_type: 'SOMETHING_NEW' }));

  assert.equal(embed.title, '✉️ 피드백');
});

test('본문이 4096자를 넘으면 말줄임으로 자르고, 비어 있으면 자리 표시 문구를 쓴다', () => {
  const long = buildFeedbackEmbed(row({ content_text: 'a'.repeat(5000) }));
  const empty = buildFeedbackEmbed(row({ content_text: '   ' }));

  assert.equal(long.description.length, 4096);
  assert.ok(long.description.endsWith('…'));
  assert.equal(empty.description, '(내용 없음)');
});

test('mailbox_feedback INSERT만 행으로 꺼내고 나머지는 null', () => {
  const record = row();

  assert.equal(
    parseFeedbackWebhook({ type: 'INSERT', table: 'mailbox_feedback', record }),
    record,
  );
  assert.equal(
    parseFeedbackWebhook({ type: 'UPDATE', table: 'mailbox_feedback', record }),
    null,
  );
  assert.equal(
    parseFeedbackWebhook({ type: 'INSERT', table: 'mailbox_letter', record }),
    null,
  );
  assert.equal(parseFeedbackWebhook(undefined), null);
});
