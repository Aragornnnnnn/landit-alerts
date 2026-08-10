// 스토어 알림 순수 로직(피드 파싱·변화 감지·embed 생성) 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildReleaseEmbed,
  buildReviewEmbed,
  classifyAscTransition,
  diffNewReviews,
  isNewerVersion,
  parseAscReleaseNotes,
  parseAscReviews,
  parseAscVersion,
  parsePlayTrack,
  ratingColor,
} from './lib.mjs';

test('별점 4~5는 초록, 3은 노랑, 1~2는 빨강 색을 쓴다', () => {
  assert.equal(ratingColor(5), ratingColor(4));
  assert.notEqual(ratingColor(4), ratingColor(3));
  assert.equal(ratingColor(2), ratingColor(1));
  assert.notEqual(ratingColor(3), ratingColor(2));
});

test('본 적 없는 리뷰만 오래된 순으로 골라낸다', () => {
  // given — 피드는 최신순, b는 이미 봤다
  const feed = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];

  const fresh = diffNewReviews(feed, ['b', 'a']);

  assert.deepEqual(
    fresh.map((r) => r.id),
    ['c'],
  );
});

test('여러 건이 새로 오면 오래된 것부터 순서대로 내보낸다', () => {
  const feed = [{ id: 'd' }, { id: 'c' }, { id: 'b' }];

  const fresh = diffNewReviews(feed, ['b']);

  assert.deepEqual(
    fresh.map((r) => r.id),
    ['c', 'd'],
  );
});

test('ASC 리뷰 응답에서 리뷰 필드를 뽑아낸다', () => {
  // given — 실제 ASC customerReviews 응답을 축약한 모양
  const json = {
    data: [
      {
        id: 'r-uuid-1',
        attributes: {
          rating: 5,
          title: '좋아여',
          body: '다른 앱들이랑 다른점이 있어서 좋은거같아요',
          reviewerNickname: '모오오오오오오오이',
          territory: 'KOR',
        },
      },
    ],
  };

  assert.deepEqual(parseAscReviews(json), [
    {
      id: 'r-uuid-1',
      author: '모오오오오오오오이',
      rating: 5,
      title: '좋아여',
      body: '다른 앱들이랑 다른점이 있어서 좋은거같아요',
    },
  ]);
});

test('ASC 리뷰 응답이 비어 있으면 빈 배열을 준다', () => {
  assert.deepEqual(parseAscReviews({ data: [] }), []);
  assert.deepEqual(parseAscReviews({}), []);
});

test('ASC 버전 응답에서 id·버전·상태를 뽑아낸다', () => {
  const json = {
    data: [
      {
        id: 'v-uuid-1',
        attributes: {
          versionString: '1.1.0',
          appVersionState: 'READY_FOR_DISTRIBUTION',
        },
      },
    ],
  };

  assert.deepEqual(parseAscVersion(json), {
    id: 'v-uuid-1',
    version: '1.1.0',
    state: 'READY_FOR_DISTRIBUTION',
  });
});

test('ASC 버전 응답이 비어 있으면 null 필드를 준다', () => {
  assert.deepEqual(parseAscVersion({ data: [] }), {
    id: null,
    version: null,
    state: null,
  });
});

test('릴리즈 노트는 한국어 현지화를 우선으로 고른다', () => {
  const json = {
    data: [
      { attributes: { locale: 'en-US', whatsNew: 'English notes' } },
      { attributes: { locale: 'ko', whatsNew: '한국어 노트' } },
    ],
  };

  assert.equal(parseAscReleaseNotes(json), '한국어 노트');
});

test('한국어 현지화가 없으면 첫 항목의 릴리즈 노트를 쓴다', () => {
  const json = {
    data: [{ attributes: { locale: 'en-US', whatsNew: 'English notes' } }],
  };

  assert.equal(parseAscReleaseNotes(json), 'English notes');
  assert.equal(parseAscReleaseNotes({ data: [] }), null);
});

test('플레이 트랙 응답에서 버전과 한국어 릴리즈 노트를 뽑아낸다', () => {
  // given — 실제 production 트랙 응답을 축약한 모양
  const json = {
    releases: [
      {
        name: '1.1.0',
        status: 'completed',
        releaseNotes: [
          { language: 'en-US', text: 'English notes' },
          { language: 'ko-KR', text: '한국어 노트' },
        ],
      },
    ],
  };

  assert.deepEqual(parsePlayTrack(json), {
    version: '1.1.0',
    releaseNotes: '한국어 노트',
  });
});

test('플레이 트랙에 단계적 출시 중 릴리즈가 있으면 그것을 우선한다', () => {
  const json = {
    releases: [
      { name: '1.2.0', status: 'inProgress', releaseNotes: [] },
      { name: '1.1.0', status: 'completed', releaseNotes: [] },
    ],
  };

  assert.equal(parsePlayTrack(json).version, '1.2.0');
});

test('플레이 트랙 응답이 비어 있으면 null 필드를 준다', () => {
  assert.deepEqual(parsePlayTrack({ releases: [] }), {
    version: null,
    releaseNotes: null,
  });
});

test('리뷰 embed는 별점 줄 아래 제목과 본문, 메타 순으로 담는다', () => {
  // given — ASC 리뷰는 작성 버전 정보를 주지 않는다
  const embed = buildReviewEmbed('appStore', {
    id: 'r1',
    author: '닉네임',
    rating: 2,
    title: '튕겨요',
    body: '자꾸 꺼집니다',
  });

  assert.equal(embed.title, '⭐⭐');
  assert.match(embed.description, /^\*\*튕겨요\*\*\n자꾸 꺼집니다/);
  assert.match(embed.description, /닉네임$/);
  assert.equal(embed.color, ratingColor(2));
  assert.equal(embed.author.name, 'App Store');
});

test('플레이 리뷰 embed는 기기·OS 메타를 함께 담는다', () => {
  const embed = buildReviewEmbed('playStore', {
    id: 'r2',
    author: '닉네임',
    rating: 4,
    title: null,
    body: '좋아요',
    version: '1.5.0',
    device: 'Galaxy S24+',
    osVersion: 'Android 15',
  });

  assert.match(
    embed.description,
    /닉네임 · v1\.5\.0 · Galaxy S24\+ · Android 15/,
  );
  assert.equal(embed.author.name, 'Play Store');
  // 플레이 리뷰는 제목이 없으므로 볼드 제목 줄 없이 본문으로 시작한다
  assert.match(embed.description, /^좋아요/);
});

test('릴리즈 embed는 해당 스토어 링크만 담는다', () => {
  const apple = buildReleaseEmbed('appStore', {
    version: '1.5.0',
    releaseNotes: '버그 수정',
  });
  const play = buildReleaseEmbed('playStore', {
    version: '1.5.0',
    releaseNotes: null,
  });

  assert.match(apple.description, /apps\.apple\.com/);
  assert.doesNotMatch(apple.description, /play\.google\.com/);
  assert.match(play.description, /play\.google\.com/);
  assert.doesNotMatch(play.description, /apps\.apple\.com/);
});

test('릴리즈 노트가 없으면 릴리즈 노트 단락을 뺀다', () => {
  const embed = buildReleaseEmbed('playStore', {
    version: '1.5.0',
    releaseNotes: null,
  });

  assert.doesNotMatch(embed.description, /릴리즈 노트/);
});

test('ASC 상태가 출시 대기로 바뀌면 승인으로 분류한다', () => {
  assert.equal(
    classifyAscTransition('IN_REVIEW', 'PENDING_DEVELOPER_RELEASE'),
    'approved',
  );
});

test('ASC 상태가 거절류로 바뀌면 거절로 분류한다', () => {
  assert.equal(classifyAscTransition('IN_REVIEW', 'REJECTED'), 'rejected');
  assert.equal(
    classifyAscTransition('IN_REVIEW', 'METADATA_REJECTED'),
    'rejected',
  );
});

test('ASC 상태가 그대로거나 이전 기록이 없으면 분류하지 않는다', () => {
  assert.equal(
    classifyAscTransition(
      'PENDING_DEVELOPER_RELEASE',
      'PENDING_DEVELOPER_RELEASE',
    ),
    null,
  );
  assert.equal(classifyAscTransition(undefined, 'REJECTED'), null);
});

test('ASC 상태가 알림 대상 아닌 값으로 바뀌면 분류하지 않는다', () => {
  assert.equal(classifyAscTransition('IN_REVIEW', 'READY_FOR_SALE'), null);
});

test('버전이 높아졌을 때만 최신으로 판정한다', () => {
  assert.equal(isNewerVersion('1.1.0', '1.0.0'), true);
  assert.equal(isNewerVersion('1.0.0', '1.1.0'), false);
  assert.equal(isNewerVersion('1.1.0', '1.1.0'), false);
});

test('버전 비교는 문자열이 아니라 숫자 단위로 한다', () => {
  // given — 문자열 비교면 "1.10.0" < "1.9.0"으로 잘못 판정된다
  assert.equal(isNewerVersion('1.10.0', '1.9.0'), true);
  assert.equal(isNewerVersion('1.0.0.1', '1.0.0'), true);
});
