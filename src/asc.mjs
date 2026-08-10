// App Store Connect API 클라이언트 — 리뷰·최신 버전 상태·릴리즈 노트를 조회한다
import { createPrivateKey, sign } from 'node:crypto';

import { assertOk } from './http.mjs';
import {
  APP_STORE_ID,
  base64url,
  parseAscReleaseNotes,
  parseAscReviews,
  parseAscVersion,
} from './lib.mjs';

const TOKEN_TTL_SECONDS = 600;
const API = 'https://api.appstoreconnect.apple.com/v1';
const REVIEW_PAGE_SIZE = 50;

const makeToken = ({ issuerId, keyId, privateKey }) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }),
  );
  const claims = base64url(
    JSON.stringify({
      iss: issuerId,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
      aud: 'appstoreconnect-v1',
    }),
  );
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${claims}.${base64url(signature)}`;
};

const get = async (credentials, path, label) => {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${makeToken(credentials)}` },
  });
  await assertOk(res, label);
  return res.json();
};

export const fetchAscReviews = async (credentials) =>
  parseAscReviews(
    await get(
      credentials,
      `/apps/${APP_STORE_ID}/customerReviews?sort=-createdDate&limit=${REVIEW_PAGE_SIZE}`,
      'ASC 리뷰 조회',
    ),
  );

// 최신 appStoreVersion의 { id, version, state }
export const fetchAscVersion = async (credentials) =>
  parseAscVersion(
    await get(
      credentials,
      `/apps/${APP_STORE_ID}/appStoreVersions?limit=1`,
      'ASC 버전 조회',
    ),
  );

// 릴리즈 알림을 보낼 때만 호출한다 (버전 상세의 현지화 문구에서 릴리즈 노트를 읽는다)
export const fetchAscReleaseNotes = async (credentials, versionId) => {
  const json = await get(
    credentials,
    `/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
    'ASC 릴리즈 노트 조회',
  );
  return parseAscReleaseNotes(json);
};
