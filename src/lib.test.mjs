// 스토어 알림 순수 로직(피드 파싱·변화 감지·embed 생성) 테스트
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRatingChangeMessage,
  buildReleaseEmbed,
  buildReviewEmbed,
  classifyAscTransition,
  detectRatingChanges,
  diffNewReviews,
  parseAppStoreFeed,
  parseAppStoreLookup,
  parsePlayStorePage,
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

test('앱스토어 RSS에서 리뷰 필드를 뽑아낸다', () => {
  // given — 실제 RSS 구조를 축약한 응답
  const feed = {
    feed: {
      entry: [
        {
          id: { label: 'r1' },
          author: { name: { label: '닉네임' } },
          'im:rating': { label: '5' },
          title: { label: '좋아요' },
          content: { label: '본문' },
          'im:version': { label: '1.4.2' },
        },
      ],
    },
  };

  const reviews = parseAppStoreFeed(feed);

  assert.deepEqual(reviews, [
    {
      id: 'r1',
      author: '닉네임',
      rating: 5,
      title: '좋아요',
      body: '본문',
      version: '1.4.2',
    },
  ]);
});

test('앱스토어 RSS에 entry가 없으면 빈 배열을 준다', () => {
  assert.deepEqual(parseAppStoreFeed({ feed: {} }), []);
});

test('앱스토어 RSS에 리뷰가 1건이면 entry가 배열이 아니어도 파싱한다', () => {
  // given — 애플 RSS는 항목이 하나면 배열 대신 객체 하나를 준다
  const feed = {
    feed: {
      entry: {
        id: { label: 'r1' },
        author: { name: { label: '닉네임' } },
        'im:rating': { label: '3' },
        title: { label: '보통' },
        content: { label: '본문' },
        'im:version': { label: '1.0.0' },
      },
    },
  };

  const reviews = parseAppStoreFeed(feed);

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].id, 'r1');
});

test('lookup 응답에서 버전·릴리즈 노트·평점을 뽑아낸다', () => {
  const lookup = {
    results: [
      {
        version: '1.5.0',
        releaseNotes: '버그 수정',
        averageUserRating: 4.812,
        userRatingCount: 132,
      },
    ],
  };

  assert.deepEqual(parseAppStoreLookup(lookup), {
    version: '1.5.0',
    releaseNotes: '버그 수정',
    rating: 4.8,
    ratingCount: 132,
  });
});

test('lookup 결과가 비어 있으면 모든 필드가 null인 객체를 준다', () => {
  // given — 파서는 항상 같은 모양을 반환한다 (null은 수집 실패에만 쓴다)
  assert.deepEqual(parseAppStoreLookup({ results: [] }), {
    version: null,
    releaseNotes: null,
    rating: null,
    ratingCount: null,
  });
});

test('플레이스토어 페이지에서 버전과 평점을 찾는다', () => {
  // given — 페이지 스크립트 데이터의 해당 패턴만 흉내낸 HTML
  const html = 'xx[[["1.5.0"]],yy"starRating":4.6123,zz';

  const parsed = parsePlayStorePage(html);

  assert.equal(parsed.version, '1.5.0');
  assert.equal(parsed.rating, 4.6);
});

test('플레이스토어 페이지에서 패턴을 못 찾으면 null 필드를 준다', () => {
  const parsed = parsePlayStorePage('<html>전혀 다른 내용</html>');

  assert.equal(parsed.version, null);
  assert.equal(parsed.rating, null);
});

test('평점이 그대로면 변동 알림을 만들지 않는다', () => {
  const prev = { appStore: { rating: 4.8 }, playStore: { rating: 4.6 } };
  const curr = {
    appStore: { rating: 4.8, ratingCount: 132 },
    playStore: { rating: 4.6, ratingCount: 87 },
  };

  assert.equal(detectRatingChanges(prev, curr), null);
});

test('한쪽 평점이 내려가면 하락 방향으로 변동을 감지한다', () => {
  const prev = { appStore: { rating: 4.8 }, playStore: { rating: 4.6 } };
  const curr = {
    appStore: { rating: 4.5, ratingCount: 132 },
    playStore: { rating: 4.6, ratingCount: 87 },
  };

  const changes = detectRatingChanges(prev, curr);

  assert.equal(changes.appStore.direction, 'down');
  assert.equal(changes.playStore, null);
});

test('평점이 오르면 상승 방향으로 변동을 감지한다', () => {
  const prev = { appStore: { rating: 4.0 }, playStore: {} };
  const curr = {
    appStore: { rating: 4.5, ratingCount: 10 },
    playStore: { rating: null },
  };

  const changes = detectRatingChanges(prev, curr);

  assert.equal(changes.appStore.direction, 'up');
  assert.equal(changes.appStore.from, 4.0);
});

test('이전 평점이 없던 스토어는 변동으로 치지 않는다', () => {
  // given — 플레이 평점을 처음 수집한 상황
  const prev = { appStore: { rating: 4.8 }, playStore: {} };
  const curr = {
    appStore: { rating: 4.8, ratingCount: 132 },
    playStore: { rating: 4.6, ratingCount: 87 },
  };

  assert.equal(detectRatingChanges(prev, curr), null);
});

test('리뷰 embed는 별점 줄 아래 제목과 본문, 메타 순으로 담는다', () => {
  const embed = buildReviewEmbed('appStore', {
    id: 'r1',
    author: '닉네임',
    rating: 2,
    title: '튕겨요',
    body: '자꾸 꺼집니다',
    version: '1.5.0',
  });

  assert.equal(embed.title, '⭐⭐');
  assert.match(embed.description, /^\*\*튕겨요\*\*\n자꾸 꺼집니다/);
  assert.match(embed.description, /닉네임 · v1\.5\.0/);
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

test('평점이 아직 없는 스토어는 집계 전으로 표기한다', () => {
  // given — 플레이스토어가 평점을 아직 노출하지 않는 상황
  const changes = {
    appStore: { direction: 'down', from: 4.8 },
    playStore: null,
  };
  const curr = {
    appStore: { rating: 4.5, ratingCount: 132 },
    playStore: { rating: null, ratingCount: null },
  };

  const embed = buildRatingChangeMessage(changes, curr);

  assert.match(embed.description, /Play Store 평점 집계 전/);
});

test('리뷰 수를 모르는 스토어는 리뷰 수 표기를 생략한다', () => {
  // given — 플레이는 페이지에서 평점만 읽혀서 리뷰 수가 없다
  const changes = { appStore: null, playStore: { direction: 'up', from: 4.4 } };
  const curr = {
    appStore: { rating: 4.8, ratingCount: 132 },
    playStore: { rating: 4.6 },
  };

  const embed = buildRatingChangeMessage(changes, curr);

  assert.match(embed.description, /Play Store \*\*4\.4 → 4\.6\*\*/);
  assert.doesNotMatch(embed.description, /리뷰 null개/);
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

test('평점 변동 메시지는 두 스토어 현황을 모두 담는다', () => {
  const changes = {
    appStore: { direction: 'down', from: 4.8 },
    playStore: null,
  };
  const curr = {
    appStore: { rating: 4.5, ratingCount: 132 },
    playStore: { rating: 4.6, ratingCount: 87 },
  };

  const embed = buildRatingChangeMessage(changes, curr);

  assert.equal(embed.title, '평점 변동이 있어요');
  assert.match(embed.description, /4\.8 → 4\.5/);
  assert.match(embed.description, /변동 없음/);
  assert.match(embed.description, /리뷰 132개/);
  assert.match(embed.description, /리뷰 87개/);
});
