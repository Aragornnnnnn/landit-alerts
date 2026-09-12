# 설문 응답 알림

설문(landit-fe `features/survey`)에 응답이 저장되면 `#유료화-전-설문` 채널에 질문·답변 형식의 카드 한 장을 보낸다.

## 왜 이 방식인가

- 응답은 슈퍼베이스 `survey_responses` 테이블에 직접 저장된다(PostgREST). 백엔드를 거치지 않는다.
- 그래서 슈퍼베이스 Database Webhook이 우리 Vercel 함수(`api/survey.mjs`)로 INSERT를 쏘고, 우리가 디스코드 형식으로 바꿔 보낸다. Sentry 알림과 같은 구조다.
- 웹훅 URL은 공개라 슈퍼베이스 쪽 HTTP 헤더에 넣어 둔 비밀값(`x-survey-secret`)이 맞을 때만 받는다.

## 카드 형식

- 문항마다 필드 하나. 제목은 질문, 값은 답변. 문항 사이는 빈 줄로 띄운다.
- 점수 문항(만족도·추천 의향)은 질문 뒤에 `(1~5)`를 붙이고 답은 `n점`으로 적는다.
- "기타"를 고른 문항은 직접 쓴 내용을 함께 보여준다.
- 답이 없는 문항은 줄을 만들지 않는다.

문항 목록·순서·id는 landit-fe의 `features/survey/model/questions.ts`와 같아야 한다.
설문 문항을 바꾸면 `src/survey.mjs`의 `QUESTIONS`도 같이 고친다.

## 구조

```text
survey_responses INSERT
  → POST https://landit-alerts.vercel.app/api/survey
    ├─ x-survey-secret 헤더가 SURVEY_WEBHOOK_SECRET과 다르면 401
    ├─ type이 INSERT가 아니거나 테이블이 다르면 200 skipped
    └─ embed 생성 → DISCORD_WEBHOOK_SURVEY로 전송
```

- 코드는 `api/survey.mjs`(수신)와 `src/survey.mjs`(순수 로직)에 있다.
- 관심 없는 요청도 200으로 답한다. 실패 응답이면 슈퍼베이스가 재시도한다.

## Vercel 환경변수

| 이름                     | 내용                                            |
| ------------------------ | ----------------------------------------------- |
| `SURVEY_WEBHOOK_SECRET`  | 슈퍼베이스 웹훅 헤더에 넣어 둔 값과 같은 문자열 |
| `DISCORD_WEBHOOK_SURVEY` | `#유료화-전-설문` 채널 웹훅 URL                 |

등록은 [reply.md](reply.md)의 방식과 같다.

```bash
printf '%s' "$값" | npx vercel env add SURVEY_WEBHOOK_SECRET production --token $TOKEN
printf '%s' "$웹훅URL" | npx vercel env add DISCORD_WEBHOOK_SURVEY production --token $TOKEN
npx vercel deploy --prod --token $TOKEN
```

## 슈퍼베이스 세팅 과정

운영 프로젝트에만 건다. develop 프로젝트에 걸면 테스트 응답이 팀 채널에 온다.

1. **디스코드 웹훅** — `#유료화-전-설문` 채널 편집 > 연동 > 웹후크 > 새 웹후크. URL 복사.
2. **환경변수 등록·배포** — 위 명령. 비밀값은 길고 무작위한 문자열을 새로 만든다.
3. **Database Webhook** — 슈퍼베이스 > Database > Webhooks > Create a new hook.
   - Table: `survey_responses`, Events: **Insert**만.
   - Type: HTTP Request, Method: POST, URL: `https://landit-alerts.vercel.app/api/survey`.
   - HTTP Headers에 `x-survey-secret` = 2번에서 등록한 값.
4. **확인** — 설문을 한 번 제출하거나, 웹훅 화면의 로그에서 200 응답을 본다.

## 밀린 응답 일괄 전송

웹훅을 걸기 전에 들어온 응답은 오래된 순으로 한 번에 보낼 수 있다.

```bash
node --env-file=<슈퍼베이스 env> --env-file=~/.landit-discord.env scripts/survey-backfill.mjs --dry-run
node --env-file=<슈퍼베이스 env> --env-file=~/.landit-discord.env scripts/survey-backfill.mjs
```

- 슈퍼베이스 env에는 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`가 있어야 한다.
- 디스코드 웹훅 속도 제한 때문에 2.5초 간격으로 보낸다.
- 1회성 스크립트다. 두 번 돌리면 같은 응답이 두 번 간다.
