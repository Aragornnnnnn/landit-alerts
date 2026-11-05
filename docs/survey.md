# 설문 응답 알림

설문(landit-fe `features/survey`) 응답이 완료되면 질문·답변 형식의 카드 한 장을 보낸다. 일반 설문은 `#유료화-전-설문` 채널로, 결제자 설문(`survey = 'paid'`)은 따로 둔 결제자 설문 채널로 간다. 카드 제목도 서로 다르다.

## 왜 이 방식인가

- 응답은 슈퍼베이스 `survey_responses` 테이블에 직접 저장된다(PostgREST). 백엔드를 거치지 않는다.
- 그래서 슈퍼베이스 Database Webhook이 우리 Vercel 함수(`api/survey.mjs`)로 INSERT·UPDATE를 쏘고, 우리가 디스코드 형식으로 바꿔 보낸다. Sentry 알림과 같은 구조다.
- 화면은 문항을 넘길 때마다 같은 행을 덮어쓰고(`completed = false`) 다 내면 `completed = true`로 마친다. 그래서 완료된 순간에만 보낸다. 한 번에 낸 INSERT이거나, `completed`가 거짓에서 참으로 바뀐 UPDATE다.
- 웹훅 URL은 공개라 슈퍼베이스 쪽 HTTP 헤더에 넣어 둔 비밀값(`x-survey-secret`)이 맞을 때만 받는다.

## 카드 형식

- 문항마다 필드 하나. 제목은 질문, 값은 답변. 문항 사이는 빈 줄로 띄운다.
- 점수 문항(만족도·추천 의향)은 질문 뒤에 `(1~5)`를 붙이고 답은 `n점`으로 적는다.
- "기타"를 고른 문항은 직접 쓴 내용을 함께 보여준다.
- 답이 없는 문항은 줄을 만들지 않는다.

문항 목록·순서·id는 landit-fe의 `features/survey/model/questions.ts`(일반)·`paid-questions.ts`(결제자)와 같아야 한다.
설문 문항을 바꾸면 `src/survey/lib.mjs`의 `GENERAL_QUESTIONS`·`PAID_QUESTIONS`도 같이 고친다.

## 구조

```text
survey_responses INSERT·UPDATE
  → POST https://landit-alerts.vercel.app/api/survey
    ├─ x-survey-secret 헤더가 SURVEY_WEBHOOK_SECRET과 다르면 401
    ├─ 테이블이 다르거나 방금 완료된 응답이 아니면 200 skipped
    └─ embed 생성 → 결제자 설문이면 DISCORD_WEBHOOK_SURVEY_PAID, 아니면 DISCORD_WEBHOOK_SURVEY로 전송
```

- 코드는 `api/survey.mjs`(수신)와 `src/survey/lib.mjs`(순수 로직)에 있다.
- 관심 없는 요청도 200으로 답한다. 실패 응답이면 슈퍼베이스가 재시도한다.

## Vercel 환경변수

| 이름                          | 내용                                               |
| ----------------------------- | -------------------------------------------------- |
| `SURVEY_WEBHOOK_SECRET`       | 슈퍼베이스 웹훅 헤더에 넣어 둔 값과 같은 문자열    |
| `DISCORD_WEBHOOK_SURVEY`      | `#유료화-전-설문` 채널 웹훅 URL                    |
| `DISCORD_WEBHOOK_SURVEY_PAID` | 결제자 설문 채널 웹훅 URL. 없으면 위 채널로 보낸다 |

등록은 [reply.md](reply.md)의 방식과 같다.

```bash
printf '%s' "$값" | npx vercel env add SURVEY_WEBHOOK_SECRET production --token $TOKEN
printf '%s' "$웹훅URL" | npx vercel env add DISCORD_WEBHOOK_SURVEY production --token $TOKEN
printf '%s' "$결제자웹훅URL" | npx vercel env add DISCORD_WEBHOOK_SURVEY_PAID production --token $TOKEN
npx vercel deploy --prod --token $TOKEN
```

## 슈퍼베이스 세팅 과정

운영 프로젝트에만 건다. develop 프로젝트에 걸면 테스트 응답이 팀 채널에 온다.

1. **디스코드 웹훅** — `#유료화-전-설문` 채널 편집 > 연동 > 웹후크 > 새 웹후크. URL 복사. 결제자 설문 채널에도 같은 방법으로 하나 만든다.
2. **환경변수 등록·배포** — 위 명령. 비밀값은 길고 무작위한 문자열을 새로 만든다.
3. **Database Webhook** — 슈퍼베이스 > Database > Webhooks > Create a new hook.
   - Table: `survey_responses`, Events: **Insert**와 **Update**.
   - Type: HTTP Request, Method: POST, URL: `https://landit-alerts.vercel.app/api/survey`.
   - HTTP Headers에 `x-survey-secret` = 2번에서 등록한 값.
4. **확인** — 설문을 한 번 제출하거나, 웹훅 화면의 로그에서 200 응답을 본다.

## 쓰다가 나간 응답

시작하고 10분이 지나도록 제출하지 않은 응답은 `🚪 쓰다가 나감` 카드로 한 번 보낸다. 거기까지 쓴 답을 담고, 채널은 완료 카드와 같다.

- 나가는 순간에는 DB에 아무 일도 일어나지 않아 웹훅으로 잡을 수 없다. 그래서 운영 슈퍼베이스의 pg_cron이 매분 찾아 `/api/survey`로 보낸다(`type: SURVEY_ABANDONED`). 카드는 시작 후 10~11분에 온다.
- GitHub Actions 크론을 쓰지 않는 것은 예약 실행이 몇 시간씩 밀려서다.
- 10분 넘게 걸려 제출하면 이탈 카드 뒤에 완료 카드도 온다. 이탈 카드는 "10분 안에 제출하지 않았다"는 뜻이다.
- 이미 보낸 응답은 `landit_alerts.survey_abandoned_alert`에 남겨 다시 보내지 않는다. 설치 전부터 있던 미완료 응답은 알리지 않는다.
- 한 번에 3건까지 보내고 나머지는 다음 검사에서 보낸다. 전송 실패를 자동으로 다시 보내지는 않는다.

설치는 운영 프로젝트에서 수신 함수를 배포한 뒤에 한다.

1. Vault에 `landit_survey_webhook_secret` 이름으로 `SURVEY_WEBHOOK_SECRET`과 같은 값을 저장한다.
2. SQL Editor에서 [`supabase/survey-abandoned.sql`](../supabase/survey-abandoned.sql)을 실행한다.
3. 이어서 [`supabase/survey-abandoned-cron.sql`](../supabase/survey-abandoned-cron.sql)을 실행한다.

멈출 때는 `SELECT cron.unschedule('landit-survey-abandoned');`를 실행한다. 검증은 빈 임시 DB에서 `psql -v ON_ERROR_STOP=1 -f scripts/test-survey-abandoned.sql`로 한다. 운영 DB에서는 돌리지 않는다.

## 밀린 응답 일괄 전송

웹훅을 걸기 전에 들어온 응답은 오래된 순으로 한 번에 보낼 수 있다.

```bash
node --env-file=<슈퍼베이스 env> --env-file=~/.landit-discord.env scripts/survey-backfill.mjs --dry-run
node --env-file=<슈퍼베이스 env> --env-file=~/.landit-discord.env scripts/survey-backfill.mjs
```

- 슈퍼베이스 env에는 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`가 있어야 한다.
- 디스코드 웹훅 속도 제한 때문에 2.5초 간격으로 보낸다.
- 1회성 스크립트다. 두 번 돌리면 같은 응답이 두 번 간다.
