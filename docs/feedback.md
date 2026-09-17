# 편지함 피드백 알림

앱 편지함에서 유저가 피드백(문제 신고·신규 기능 요청·궁금한 점 문의·개발자 응원)을 보내면 `#앱-피드백` 채널에 카드 한 장을 보낸다.

## 왜 이 방식인가

- 피드백은 백엔드가 `mailbox_feedback` 테이블에 저장한다. 그 DB가 슈퍼베이스라 설문과 같은 길을 쓸 수 있다.
- 슈퍼베이스 Database Webhook이 우리 Vercel 함수(`api/feedback.mjs`)로 INSERT를 쏘고, 우리가 디스코드 형식으로 바꿔 보낸다. 백엔드 코드는 건드리지 않는다.
- 웹훅 URL은 공개라 슈퍼베이스 쪽 HTTP 헤더에 넣어 둔 비밀값(`x-feedback-secret`)이 맞을 때만 받는다.

## 카드 형식

- 맨 위 author 줄에 토스페이스 아이콘 + 유형 이름(앱 선택 화면과 같은 말). 유형마다 색이 다르다.
- 본문은 유저가 쓴 글 그대로. 그 아래 `어드민에서 보기` 링크 한 줄(`https://admin.landit.im/feedbacks?open=<피드백 id>`). 링크까지 합쳐 4096자를 넘으면 본문을 말줄임.
- footer에 보낸 사람 id만 적는다. 닉네임·이메일·피드백 id는 싣지 않는다(어드민에서 본다).
- 보낸 시각을 footer 옆에 붙인다. 저장값(`created_at`)은 시간대 없는 한국 시각이라 +09:00으로 읽는다.

아이콘은 리뷰 카드의 스토어 로고와 같은 방식이다. 토스페이스 SVG(landit-fe `shared/ui/emoji/emoji-map.ts`)를 브라우저 캔버스로 128px PNG로 굽고, `scripts/upload-app-emoji.mjs`로 앱 이모지에 올린 뒤 그 id로 `https://cdn.discordapp.com/emojis/<id>.png`를 author 아이콘에 쓴다.

```bash
node --env-file=~/.landit-discord.env scripts/upload-app-emoji.mjs tossbug=bug.png tossbulb=feature.png tossraisehand=question.png tossraisinghands=cheer.png
```

찍힌 id를 `src/feedback/lib.mjs`의 `FEEDBACK_TYPES[*].emojiId`에 넣는다. 비어 있으면 아이콘 없이 이름만 나간다.

유형이 늘면 `FEEDBACK_TYPES`에 추가한다. 모르는 유형은 회색 "피드백" 카드로 온다.

## 구조

```text
mailbox_feedback INSERT
  → POST https://landit-alerts.vercel.app/api/feedback
    ├─ x-feedback-secret 헤더가 FEEDBACK_WEBHOOK_SECRET과 다르면 401
    ├─ type이 INSERT가 아니거나 테이블이 다르면 200 skipped
    └─ embed 생성 → DISCORD_WEBHOOK_FEEDBACK으로 전송
```

- 코드는 `api/feedback.mjs`(수신)와 `src/feedback/lib.mjs`(순수 로직)에 있다.
- 관심 없는 요청도 200으로 답한다. 실패 응답이면 슈퍼베이스가 재시도한다.

## Vercel 환경변수

| 이름                       | 내용                                            |
| -------------------------- | ----------------------------------------------- |
| `FEEDBACK_WEBHOOK_SECRET`  | 슈퍼베이스 웹훅 헤더에 넣어 둔 값과 같은 문자열 |
| `DISCORD_WEBHOOK_FEEDBACK` | `#앱-피드백` 채널 웹훅 URL                      |

```bash
printf '%s' "$값" | npx vercel env add FEEDBACK_WEBHOOK_SECRET production
printf '%s' "$웹훅URL" | npx vercel env add DISCORD_WEBHOOK_FEEDBACK production
npx vercel deploy --prod
```

## 슈퍼베이스 세팅 과정

운영 프로젝트에만 건다. develop 프로젝트에 걸면 테스트 피드백이 팀 채널에 온다.

1. **디스코드 웹훅** — `#앱-피드백` 채널 편집 > 연동 > 웹후크 > 새 웹후크. URL 복사.
2. **환경변수 등록·배포** — 위 명령. 비밀값은 길고 무작위한 문자열을 새로 만든다.
3. **Database Webhook** — 슈퍼베이스 > Database > Webhooks > Create a new hook.
   - Table: `mailbox_feedback`, Events: **Insert**만.
   - Type: HTTP Request, Method: POST, URL: `https://landit-alerts.vercel.app/api/feedback`.
   - HTTP Headers에 `x-feedback-secret` = 2번에서 등록한 값.
4. **확인** — 앱에서 피드백을 하나 보내거나, 웹훅 화면의 로그에서 200 응답을 본다.

## 밀린 피드백 일괄 전송

웹훅을 걸기 전에 들어온 피드백은 오래된 순으로 한 번에 보낼 수 있다.

```bash
node --env-file=~/.landit-supabase-prod.env --env-file=~/.landit-discord.env scripts/feedback-backfill.mjs --dry-run
node --env-file=~/.landit-supabase-prod.env --env-file=~/.landit-discord.env scripts/feedback-backfill.mjs
```

- 슈퍼베이스 env에는 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, 디스코드 env에는 `DISCORD_WEBHOOK_FEEDBACK`이 있어야 한다.
- 웹훅이 이미 보낸 것과 겹치지 않게 `--after=<피드백 id>`로 그 id보다 큰 것만 보낼 수 있다.
- 디스코드 웹훅 속도 제한 때문에 2.5초 간격으로 보낸다.
- 1회성 스크립트다. 두 번 돌리면 같은 피드백이 두 번 간다.
