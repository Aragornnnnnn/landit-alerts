# Sentry 이슈 알림

Sentry에 새 이슈가 생기면 프로젝트별 디스코드 채널(`#web-sentry`, `#mobile-sentry`)에 카드 한 장을 보낸다.

## 왜 이 방식인가

- Sentry의 공식 Discord 연동은 Team 플랜부터라 쓸 수 없다.
- 그래서 Sentry가 우리 주소로 웹훅을 쏘고, 우리가 디스코드 형식으로 바꿔 보낸다. 백엔드 알림과 같은 구조다.
- 수신은 리뷰 답글·설문과 같은 Vercel 함수(`api/sentry.mjs`)에 얹었다. 새 서버는 없다.
- 프로젝트 설정의 Legacy Integrations > WebHooks 대신 **내부 연동(Internal Integration)** 을 쓴다. 요청마다 HMAC 서명이 붙어 아무나 채널에 글을 못 쓴다.

## 카드 형식

```text
🔴 TypeError: Cannot read properties of undefined     ← 제목 = Sentry 이슈 링크
app/(home)/page.tsx in onClick                        ← culprit
환경 production   릴리즈 v1.4.0   사용자 a@b.com
브라우저 Safari 18   OS iOS 18.6
URL https://landit.im/home
규칙 · 새 이슈                                          ← 발동한 알림 규칙 이름
```

- 색과 이모지는 레벨을 따른다. fatal·error 빨강 🔴, warning 노랑 🟡, info·debug 파랑 🔵.
- 없는 정보(릴리즈·사용자·태그)는 줄을 만들지 않는다.
- Sentry에서 멘션·할당 같은 상호작용은 없다. 링크를 눌러 Sentry에서 처리한다.

## 구조

```text
Sentry 알림 규칙 발동
  → POST https://landit-alerts.vercel.app/api/sentry
    ├─ Sentry-Hook-Signature 검증 (HMAC-SHA256, Client Secret) — 실패 시 401
    ├─ Sentry-Hook-Resource가 event_alert가 아니면 200 skipped (설치 이벤트 등)
    ├─ event.project id → SENTRY_CHANNELS에서 채널 웹훅 조회, 없으면 200 skipped
    └─ embed 생성 → 디스코드 웹훅 전송
```

- 코드는 `api/sentry.mjs`(수신)와 `src/sentry.mjs`(순수 로직)에 있다.
- 서명은 raw body로 먼저 보고, 안 맞으면 `JSON.stringify(JSON.parse(body))`로 한 번 더 본다. Sentry 문서가 후자 기준으로 서명한다고 안내하기 때문이다.
- 관심 없는 요청도 200으로 답한다. 실패 응답이 쌓이면 Sentry가 웹훅을 자동으로 끈다.
- payload에는 프로젝트 슬러그가 없고 숫자 id만 온다. 그래서 채널 매핑 키가 프로젝트 id다.

## Vercel 환경변수

| 이름                   | 내용                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `SENTRY_CLIENT_SECRET` | 내부 연동 상세 화면의 Client Secret                                      |
| `SENTRY_CHANNELS`      | `{"<web 프로젝트 id>":"<웹훅 URL>","<mobile 프로젝트 id>":"<웹훅 URL>"}` |

등록은 [reply.md](reply.md)의 방식과 같다.

```bash
printf '%s' "$값" | npx vercel env add SENTRY_CLIENT_SECRET production --token $TOKEN
printf '%s' '{"123":"https://discord.com/api/webhooks/...","456":"https://discord.com/api/webhooks/..."}' \
  | npx vercel env add SENTRY_CHANNELS production --token $TOKEN
npx vercel deploy --prod --token $TOKEN
```

## Sentry 세팅 과정

1. **프로젝트 id 확인** — Sentry > Settings > Projects > 프로젝트 클릭. 주소창이나 General Settings에 숫자 id가 있다. web·mobile 둘 다 적어 둔다.
2. **디스코드 웹훅** — `#web-sentry`, `#mobile-sentry` 각각 채널 편집 > 연동 > 웹후크 > 새 웹후크. 이름 `Sentry`, 아바타는 Sentry 로고. URL 복사.
3. **환경변수 등록·배포** — 위 명령. `SENTRY_CLIENT_SECRET`은 4번에서 받으므로 `SENTRY_CHANNELS`를 먼저 넣고, 시크릿은 4번 뒤에 넣은 다음 배포한다.
4. **내부 연동 생성** — Sentry > Settings > Developer Settings > Custom Integrations > Create New Integration > **Internal Integration**.
   - Name: `landit-alerts`
   - Webhook URL: `https://landit-alerts.vercel.app/api/sentry`
   - **Alert Rule Action** 켜기 — 알림 규칙의 액션 목록에 이 연동이 나타나게 하는 스위치다.
   - Permissions: Issue & Event → Read. 나머지는 No Access.
   - 저장하면 상세 화면에 Client Secret이 보인다. 이 값을 `SENTRY_CLIENT_SECRET`으로 등록하고 배포한다.
5. **알림 규칙** — 프로젝트별로 Alerts > Create Alert > Issues.
   - When: `A new issue is created` (기본값).
   - Then: `Send a notification via landit-alerts`.
   - 이름은 `새 이슈`. 카드 하단 "규칙 · 새 이슈"에 이 이름이 찍힌다.
   - 기본으로 생긴 메일 알림 규칙이 있으면 그 규칙의 액션만 바꿔도 된다.
6. **확인** — Sentry 프로젝트의 Settings > Client Keys 옆 "Send test event"나 앱에서 일부러 에러 한 번. 채널에 카드가 오면 끝.

같은 이슈가 반복 발생해도 다시 알리지 않는다. Sentry의 `A new issue is created` 규칙이 이슈당 한 번만 발동하기 때문이다. 재발 알림이 필요하면 규칙 조건에 `The issue changes state from resolved to unresolved`를 추가한다.
