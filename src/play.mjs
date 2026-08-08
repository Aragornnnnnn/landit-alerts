// Google Play Developer API 클라이언트 — 서비스 계정 JWT로 리뷰를 조회한다
import { createSign } from "node:crypto";

import { PLAY_PACKAGE } from "./lib.mjs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

const base64url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fetchAccessToken = async (serviceAccount) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 600,
    }),
  );
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${claims}`)
    .sign(serviceAccount.private_key);
  const jwt = `${header}.${claims}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok)
    throw new Error(`구글 토큰 발급 실패 ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
};

// API 레벨 → 사용자에게 익숙한 Android 버전 표기
const OS_NAMES = {
  31: "12",
  32: "12L",
  33: "13",
  34: "14",
  35: "15",
  36: "16",
  37: "17",
};
const osLabel = (apiLevel) =>
  apiLevel == null
    ? null
    : `Android ${OS_NAMES[apiLevel] ?? `API ${apiLevel}`}`;

export const fetchPlayReviews = async (serviceAccountJson) => {
  const serviceAccount = JSON.parse(serviceAccountJson);
  const token = await fetchAccessToken(serviceAccount);
  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}/reviews?maxResults=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok)
    throw new Error(`플레이 리뷰 조회 실패 ${res.status}: ${await res.text()}`);
  const { reviews = [] } = await res.json();

  return reviews.map((r) => {
    const c = r.comments?.[0]?.userComment ?? {};
    return {
      id: r.reviewId,
      author: r.authorName || "익명",
      rating: c.starRating ?? 0,
      title: null,
      body: (c.text ?? "").trim(),
      version: c.appVersionName ?? "?",
      device: c.deviceMetadata?.productName ?? c.device ?? null,
      osVersion: osLabel(c.androidOsVersion),
    };
  });
};
