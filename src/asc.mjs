// App Store Connect API 클라이언트 — 최신 버전의 심사 상태를 조회한다
import { createPrivateKey, sign } from 'node:crypto';

import { assertOk } from './http.mjs';
import { APP_STORE_ID, base64url } from './lib.mjs';

const makeToken = ({ issuerId, keyId, privateKey }) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }),
  );
  const claims = base64url(
    JSON.stringify({
      iss: issuerId,
      iat: now,
      exp: now + 600,
      aud: 'appstoreconnect-v1',
    }),
  );
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${claims}.${base64url(signature)}`;
};

// 최신 appStoreVersion의 { version, state }를 준다
export const fetchAscVersionState = async (credentials) => {
  const token = makeToken(credentials);
  const res = await fetch(
    `https://api.appstoreconnect.apple.com/v1/apps/${APP_STORE_ID}/appStoreVersions?limit=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  await assertOk(res, 'ASC 버전 조회');
  const { data = [] } = await res.json();
  const latest = data[0];
  if (!latest) return null;
  return {
    version: latest.attributes.versionString,
    state: latest.attributes.appVersionState ?? latest.attributes.appStoreState,
  };
};
