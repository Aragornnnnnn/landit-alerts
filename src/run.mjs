// 스토어 알림 실행부 — 상태 파일과 비교해 새 리뷰·릴리즈·평점 변동을 디스코드로 보낸다
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { fetchAscVersionState } from './asc.mjs';
import { sendEmbed } from './discord.mjs';
import { fetchOk } from './http.mjs';
import {
  APP_STORE_ID,
  buildRatingChangeMessage,
  buildReleaseEmbed,
  buildReviewApprovedEmbed,
  buildReviewEmbed,
  buildReviewRejectedEmbed,
  classifyAscTransition,
  detectRatingChanges,
  diffNewReviews,
  parseAppStoreFeed,
  parseAppStoreLookup,
  parsePlayStorePage,
  PLAY_STORE_URL,
} from './lib.mjs';
import { fetchPlayReviews } from './play.mjs';

const STATE_FILE = process.env.STATE_FILE ?? '.state/store-alerts.json';
const REVIEW_WEBHOOK = process.env.DISCORD_WEBHOOK_REVIEW;
const UPDATE_WEBHOOK = process.env.DISCORD_WEBHOOK_UPDATE;
const MAX_POSTS_PER_RUN = 10;
const SEEN_LIMIT = 300;

if (!REVIEW_WEBHOOK || !UPDATE_WEBHOOK) {
  console.error(
    'DISCORD_WEBHOOK_REVIEW / DISCORD_WEBHOOK_UPDATE 환경변수가 필요합니다.',
  );
  process.exit(1);
}

const loadState = async () => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
};

const fetchJson = async (url) => (await fetchOk(url)).json();
const fetchText = async (url) =>
  (await fetchOk(url, 'Mozilla/5.0 (LanditAlerts)')).text();

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

const hasAscKeys =
  process.env.ASC_ISSUER_ID &&
  process.env.ASC_KEY_ID &&
  process.env.ASC_PRIVATE_KEY;

const [appStoreFeed, appStoreInfo, playPage, playReviews, ascState] =
  await Promise.all([
    collect('앱스토어 RSS', async () =>
      parseAppStoreFeed(
        await fetchJson(
          `https://itunes.apple.com/kr/rss/customerreviews/id=${APP_STORE_ID}/sortBy=mostRecent/json`,
        ),
      ),
    ),
    collect('앱스토어 lookup', async () =>
      parseAppStoreLookup(
        await fetchJson(
          `https://itunes.apple.com/kr/lookup?id=${APP_STORE_ID}`,
        ),
      ),
    ),
    collect('플레이 페이지', async () =>
      parsePlayStorePage(await fetchText(`${PLAY_STORE_URL}&hl=ko`)),
    ),
    process.env.PLAY_SERVICE_ACCOUNT_JSON
      ? collect('플레이 리뷰', () =>
          fetchPlayReviews(
            process.env.PLAY_SERVICE_ACCOUNT_JSON,
            state.playSeenIds ?? [],
          ),
        )
      : null,
    hasAscKeys
      ? collect('ASC 심사 상태', () =>
          fetchAscVersionState({
            issuerId: process.env.ASC_ISSUER_ID,
            keyId: process.env.ASC_KEY_ID,
            privateKey: process.env.ASC_PRIVATE_KEY,
          }),
        )
      : null,
  ]);

// ---- 알림 (첫 실행은 기준점만 저장) ----
let posted = 0;
const post = async (webhook, embed) => {
  if (firstRun || posted >= MAX_POSTS_PER_RUN) return;
  await sendEmbed(webhook, embed);
  posted += 1;
};

const notifyNewReviews = async (store, reviews, seenIds) => {
  seenIds ??= [];
  if (!reviews) return seenIds;
  for (const review of diffNewReviews(reviews, seenIds)) {
    await post(REVIEW_WEBHOOK, buildReviewEmbed(store, review));
  }
  return [...new Set([...reviews.map((r) => r.id), ...seenIds])].slice(
    0,
    SEEN_LIMIT,
  );
};

state.appStoreSeenIds = await notifyNewReviews(
  'appStore',
  appStoreFeed,
  state.appStoreSeenIds,
);
state.playSeenIds = await notifyNewReviews(
  'playStore',
  playReviews,
  state.playSeenIds,
);

if (
  appStoreInfo?.version &&
  state.appStoreVersion &&
  appStoreInfo.version !== state.appStoreVersion
) {
  await post(UPDATE_WEBHOOK, buildReleaseEmbed('appStore', appStoreInfo));
}
if (
  playPage?.version &&
  state.playVersion &&
  playPage.version !== state.playVersion
) {
  await post(
    UPDATE_WEBHOOK,
    buildReleaseEmbed('playStore', { version: playPage.version }),
  );
}

const currentRatings = {
  appStore: {
    rating: appStoreInfo?.rating,
    ratingCount: appStoreInfo?.ratingCount,
  },
  playStore: { rating: playPage?.rating },
};
const ratingChanges = detectRatingChanges(state.ratings, currentRatings);
if (ratingChanges) {
  await post(
    REVIEW_WEBHOOK,
    buildRatingChangeMessage(ratingChanges, currentRatings),
  );
}

if (ascState) {
  const transition = classifyAscTransition(
    state.ascState?.state,
    ascState.state,
  );
  if (transition === 'approved') {
    await post(UPDATE_WEBHOOK, buildReviewApprovedEmbed(ascState.version));
  } else if (transition === 'rejected') {
    await post(UPDATE_WEBHOOK, buildReviewRejectedEmbed(ascState.version));
  }
}

// ---- 상태 저장 (수집 실패한 항목은 이전 값 유지) ----
state.initialized = true;
if (appStoreInfo?.version) state.appStoreVersion = appStoreInfo.version;
if (playPage?.version) state.playVersion = playPage.version;
state.ratings = {
  appStore:
    currentRatings.appStore.rating != null
      ? currentRatings.appStore
      : state.ratings?.appStore,
  playStore:
    currentRatings.playStore.rating != null
      ? currentRatings.playStore
      : state.ratings?.playStore,
};
if (ascState) state.ascState = ascState;

await mkdir(dirname(STATE_FILE), { recursive: true });
await writeFile(STATE_FILE, JSON.stringify(state, null, 2));

console.log(
  firstRun
    ? '첫 실행 — 기준점만 저장했습니다.'
    : `완료 — 알림 ${posted}건 전송.${errors.length ? ` 수집 실패: ${errors.join(' / ')}` : ''}`,
);
if (errors.length && !firstRun) console.error(errors.join('\n'));
