// 스토어 알림 실행부 — 상태 파일과 비교해 새 리뷰·릴리즈·심사 변화를 디스코드로 보낸다
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  fetchAscReleaseNotes,
  fetchAscReviews,
  fetchAscVersion,
} from './asc.mjs';
import { sendEmbed } from './discord.mjs';
import {
  buildReleaseEmbed,
  buildReviewApprovedEmbed,
  buildReviewEmbed,
  buildReviewRejectedEmbed,
  classifyAscTransition,
  diffNewReviews,
  isNewerVersion,
} from './lib.mjs';
import { buildReplyButton } from './interaction-lib.mjs';
import { fetchPlayReviews, fetchPlayTrack } from './play.mjs';

const STATE_FILE = process.env.STATE_FILE ?? '.state/store-alerts.json';
const REVIEW_WEBHOOK = process.env.DISCORD_WEBHOOK_REVIEW;
const UPDATE_WEBHOOK = process.env.DISCORD_WEBHOOK_UPDATE;
const PLAY_KEY = process.env.PLAY_SERVICE_ACCOUNT_JSON;
const MAX_POSTS_PER_RUN = 10;
const SEEN_LIMIT = 300;

const ascCredentials = {
  issuerId: process.env.ASC_ISSUER_ID,
  keyId: process.env.ASC_KEY_ID,
  privateKey: process.env.ASC_PRIVATE_KEY,
};

const missing = [
  !REVIEW_WEBHOOK && 'DISCORD_WEBHOOK_REVIEW',
  !UPDATE_WEBHOOK && 'DISCORD_WEBHOOK_UPDATE',
  !ascCredentials.issuerId && 'ASC_ISSUER_ID',
  !ascCredentials.keyId && 'ASC_KEY_ID',
  !ascCredentials.privateKey && 'ASC_PRIVATE_KEY',
  !PLAY_KEY && 'PLAY_SERVICE_ACCOUNT_JSON',
].filter(Boolean);
if (missing.length) {
  console.error(`환경변수가 필요합니다: ${missing.join(', ')}`);
  process.exit(1);
}

const loadState = async () => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
};

// ---- 수집 (서로 독립이라 병렬로 돈다) ----
const state = (await loadState()) ?? {};
const firstRun = !state.initialized;
const errors = [];

const collect = async (label, fn) => {
  try {
    return await fn();
  } catch (e) {
    errors.push(`${label}: ${e.message}`);
    return null;
  }
};

const [ascReviews, ascVersion, playReviews, playTrack] = await Promise.all([
  collect('ASC 리뷰', () => fetchAscReviews(ascCredentials)),
  collect('ASC 버전', () => fetchAscVersion(ascCredentials)),
  collect('플레이 리뷰', () =>
    fetchPlayReviews(PLAY_KEY, state.playSeenIds ?? []),
  ),
  collect('플레이 트랙', () => fetchPlayTrack(PLAY_KEY)),
]);

// ---- 알림 (첫 실행은 기준점만 저장) ----
let posted = 0;
const post = async (webhook, embed, components) => {
  if (firstRun || posted >= MAX_POSTS_PER_RUN) return;
  await sendEmbed(webhook, embed, components);
  posted += 1;
};

// seenIds가 아예 없으면(스토어를 처음 수집) 알림 없이 기준점만 시드한다
const notifyNewReviews = async (store, reviews, seenIds) => {
  if (!reviews) return seenIds;
  if (seenIds === undefined) return reviews.map((r) => r.id);
  for (const review of diffNewReviews(reviews, seenIds)) {
    await post(REVIEW_WEBHOOK, buildReviewEmbed(store, review), [
      buildReplyButton(store, review.id, false),
    ]);
  }
  return [...new Set([...reviews.map((r) => r.id), ...seenIds])].slice(
    0,
    SEEN_LIMIT,
  );
};

state.ascSeenIds = await notifyNewReviews(
  'appStore',
  ascReviews,
  state.ascSeenIds,
);
state.playSeenIds = await notifyNewReviews(
  'playStore',
  playReviews,
  state.playSeenIds,
);

// ---- iOS 릴리즈·심사 (ASC 버전 상태 하나로 둘 다 판정) ----
// 마이그레이션 — 공개 lookup 시절 저장한 버전을 이어받는다
state.ascReleasedVersion ??= state.appStoreVersion;

if (ascVersion?.version) {
  const released =
    ascVersion.state === 'READY_FOR_DISTRIBUTION' &&
    (!state.ascReleasedVersion ||
      isNewerVersion(ascVersion.version, state.ascReleasedVersion));
  if (released) {
    const releaseNotes = await collect('ASC 릴리즈 노트', () =>
      fetchAscReleaseNotes(ascCredentials, ascVersion.id),
    );
    await post(
      UPDATE_WEBHOOK,
      buildReleaseEmbed('appStore', {
        version: ascVersion.version,
        releaseNotes,
      }),
    );
    state.ascReleasedVersion = ascVersion.version;
  }

  const transition = classifyAscTransition(
    state.ascState?.state,
    ascVersion.state,
  );
  if (transition === 'approved') {
    await post(UPDATE_WEBHOOK, buildReviewApprovedEmbed(ascVersion.version));
  } else if (transition === 'rejected') {
    await post(UPDATE_WEBHOOK, buildReviewRejectedEmbed(ascVersion.version));
  }
  state.ascState = { version: ascVersion.version, state: ascVersion.state };
}

// ---- Android 릴리즈 (프로덕션 트랙 기준) ----
if (playTrack?.version) {
  if (
    state.playVersion &&
    isNewerVersion(playTrack.version, state.playVersion)
  ) {
    await post(UPDATE_WEBHOOK, buildReleaseEmbed('playStore', playTrack));
  }
  if (
    !state.playVersion ||
    isNewerVersion(playTrack.version, state.playVersion)
  ) {
    state.playVersion = playTrack.version;
  }
}

// ---- 상태 저장 (수집 실패한 항목은 이전 값 유지) ----
state.initialized = true;
delete state.appStoreSeenIds;
delete state.appStoreVersion;
delete state.ratings;
delete state.pendingRatings;

await mkdir(dirname(STATE_FILE), { recursive: true });
await writeFile(STATE_FILE, JSON.stringify(state, null, 2));

console.log(
  firstRun
    ? '첫 실행 — 기준점만 저장했습니다.'
    : `완료 — 알림 ${posted}건 전송.${errors.length ? ` 수집 실패: ${errors.join(' / ')}` : ''}`,
);
if (errors.length && !firstRun) console.error(errors.join('\n'));
