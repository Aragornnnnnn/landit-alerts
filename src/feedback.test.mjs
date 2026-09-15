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
  created_at: '2026-09-12T14:25:54.723189',
  ...overrides,
});

test('유형 이름을 author에, 본문과 어드민 링크를 설명에, 보낸 사람 id를 footer에 적는다', () => {
  const embed = buildFeedbackEmbed(row());

  assert.equal(embed.author.name, '문제 신고');
  assert.equal(
    embed.description,
    '발음 평가가 안 끝나요\n\n[어드민에서 보기](https://admin.landit.im/feedbacks?open=34)',
  );
  assert.equal(embed.footer.text, 'user 12');
  // 저장값은 한국 시각이라 UTC로는 9시간 전이다
  assert.equal(embed.timestamp, '2026-09-12T05:25:54.723Z');
  assert.equal(embed.color, 0xe74c3c);
});

test('네 유형의 이름은 앱 선택 화면과 같다', () => {
  const names = ['BUG_REPORT', 'FEATURE_REQUEST', 'QUESTION', 'CHEER'].map(
    (feedback_type) => buildFeedbackEmbed(row({ feedback_type })).author.name,
  );

  assert.deepEqual(names, [
    '문제 신고',
    '신규 기능 요청',
    '궁금한 점 문의',
    '개발자 응원',
  ]);
});

test('모르는 유형이 와도 카드를 만든다', () => {
  const embed = buildFeedbackEmbed(row({ feedback_type: 'SOMETHING_NEW' }));

  assert.equal(embed.author.name, '피드백');
});

test('본문이 길면 링크까지 합쳐 4096자가 되게 말줄임으로 자르고, 비어 있으면 자리 표시 문구를 쓴다', () => {
  const long = buildFeedbackEmbed(row({ content_text: 'a'.repeat(5000) }));
  const empty = buildFeedbackEmbed(row({ content_text: '   ' }));

  assert.equal(long.description.length, 4096);
  assert.ok(long.description.includes('…\n\n[어드민에서 보기]'));
  assert.ok(empty.description.startsWith('(내용 없음)\n\n'));
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
