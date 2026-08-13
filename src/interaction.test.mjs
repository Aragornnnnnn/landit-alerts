// 답글 버튼 상호작용 순수 로직(식별자 인코딩·컴포넌트 생성) 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyReplyToEmbed,
  buildReplyButton,
  buildReplyModal,
  decodeCustomId,
  encodeCustomId,
} from './interaction-lib.mjs';

test('버튼 식별자에 동작·스토어·리뷰 ID를 담고 그대로 복원한다', () => {
  const id = encodeCustomId('reply', 'appStore', '00000194-8fb8-b903');

  assert.deepEqual(decodeCustomId(id), {
    action: 'reply',
    store: 'appStore',
    reviewId: '00000194-8fb8-b903',
  });
});

test('플레이 리뷰 ID에 콜론이 있어도 복원된다', () => {
  // given — Play 리뷰 ID는 "gp:AOqpTOE..." 형태로 콜론을 포함한다
  const id = encodeCustomId('edit', 'playStore', 'gp:AOqpTOE123');

  assert.equal(decodeCustomId(id).reviewId, 'gp:AOqpTOE123');
});

test('버튼 식별자는 디스코드 제한(100자)을 넘지 않는다', () => {
  const longPlayId = 'gp:' + 'A'.repeat(80);

  assert.ok(encodeCustomId('reply', 'playStore', longPlayId).length <= 100);
});

test('답글 전 버튼은 답글 달기, 답글 후 버튼은 수정으로 표기한다', () => {
  const fresh = buildReplyButton('appStore', 'r1', false);
  const replied = buildReplyButton('appStore', 'r1', true);

  assert.match(fresh.components[0].label, /답글 달기/);
  assert.match(replied.components[0].label, /수정/);
  assert.equal(decodeCustomId(fresh.components[0].custom_id).action, 'reply');
  assert.equal(decodeCustomId(replied.components[0].custom_id).action, 'edit');
});

test('답글 모달은 기존 답글을 프리필한다', () => {
  const modal = buildReplyModal('playStore', 'r1', '기존 답글 내용');

  const input = modal.components[0].components[0];
  assert.equal(input.value, '기존 답글 내용');
  assert.equal(decodeCustomId(modal.custom_id).reviewId, 'r1');
});

test('기존 답글이 없으면 모달 입력이 비어 있다', () => {
  const modal = buildReplyModal('appStore', 'r1', null);

  const input = modal.components[0].components[0];
  assert.equal(input.value, undefined);
});

test('답글 성공 시 embed에 답글 내용과 작성자를 붙인다', () => {
  const embed = { title: '⭐⭐⭐⭐⭐', description: '본문', color: 1 };

  const updated = applyReplyToEmbed(embed, '감사합니다!', '준서');

  assert.match(updated.fields[0].value, /─/);
  assert.equal(updated.fields[1].name, '✅ 답글 — 준서');
  assert.equal(updated.fields[1].value, '감사합니다!');
  assert.equal(updated.title, '⭐⭐⭐⭐⭐');
});

test('답글을 수정하면 기존 답글 필드를 교체한다', () => {
  // given — 이미 구분선과 답글 필드가 붙어 있는 카드
  const embed = {
    title: 't',
    fields: [
      { name: '\u200b', value: '──────────────' },
      { name: '✅ 답글 — 준서', value: '옛 답글' },
    ],
  };

  const updated = applyReplyToEmbed(embed, '고친 답글', '팀원');

  assert.equal(updated.fields.length, 2);
  assert.equal(updated.fields[1].name, '✅ 답글 — 팀원');
  assert.equal(updated.fields[1].value, '고친 답글');
});
