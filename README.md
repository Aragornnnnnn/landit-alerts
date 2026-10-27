# landit-alerts

랜딧 운영 알림을 한곳에서 만든다. 스토어 소식, 유저가 남긴 말, 서비스 장애, 매일 아침 지표까지 디스코드로 보낸다.

주기적으로 확인하는 알림은 GitHub Actions 크론이, 밖에서 들어오는 알림은 Vercel 함수가 받는다. 따로 띄워 두는 서버는 없다.

## 무엇을 알리나

| 알림                       | 채널                           | 방식                  |
| -------------------------- | ------------------------------ | --------------------- |
| 새 리뷰 (양쪽 스토어)      | `#앱-리뷰`                     | 30분마다 확인         |
| 새 버전 공개 (양쪽 스토어) | `#앱-소식`                     | 30분마다 확인         |
| 애플 심사 통과·거절        | `#앱-소식`                     | 30분마다 확인         |
| 서드파티 서비스 장애·복구  | `#의존-서비스`                 | 15분마다 확인         |
| 일일·주간 지표             | `#일일-지표` `#주간-지표`      | 매일 9시, 월요일 주간 |
| 편지함 피드백              | `#앱-피드백`                   | 슈퍼베이스 웹훅       |
| 설문 응답                  | `#유료화-전-설문`              | 슈퍼베이스 웹훅       |
| 친구 초대 등록             | 레퍼럴 수신 채널               | 슈퍼베이스 웹훅       |
| Sentry 새 이슈             | `#sentry-web` `#sentry-mobile` | Sentry 내부 연동 웹훅 |

여기서 보내지 않는 것도 있다. `#웹-상태`는 UptimeRobot이, `#revenuecat`은 RevenueCat 내장 연동이 직접 보낸다.
디스코드 카테고리가 뮤트 단위다. 🚨 장애 · 💰 결제·구독 · 📣 유저 목소리 · 📊 지표 · 🚀 배포·스토어.

카드가 어떻게 보이는지는 [docs/cards.md](docs/cards.md). 세팅 과정은 알림마다 문서가 따로 있다.
[리뷰 답글](docs/reply.md) · [편지함 피드백](docs/feedback.md) · [설문](docs/survey.md) · [친구 초대](docs/referral.md) · [Sentry](docs/sentry.md) · [서드파티 상태](docs/status.md) · [지표](docs/metrics.md) · [웹 접속 감시](docs/uptime.md)

## 어떻게 동작하나

- **주기 확인 (스토어·서드파티 상태)** — 지금 상태를 물어 지난 실행의 상태(Actions 캐시)와 비교하고, 달라진 것만 보낸다. 첫 실행은 기준점만 저장한다. 판정 조건과 반복 알림 방어는 [docs/alert-flow.md](docs/alert-flow.md).
- **지표** — 버셀 크론이 깃허브 워크플로를 깨우고, 앰플리튜드·RevenueCat·슈퍼베이스에 어제와 그제를 물어 증감과 함께 보낸다. 조회가 실패하면 침묵하지 않고 실패를 알린다. [docs/metrics.md](docs/metrics.md).
- **웹훅 수신** — `api/` 아래 함수가 Vercel(`https://landit-alerts.vercel.app`)에서 돈다. 외부가 우리 주소로 보내면 검증하고 디스코드 형식으로 바꿔 보낸다. 무엇을 받고 어떻게 검증하는지는 각 기능 문서에 있다.

데이터는 전부 공식 인증 API에서 가져온다. 공개 엔드포인트(RSS·lookup·페이지 파싱)는 캐시 흔들림 문제로 폐기했다.

## 코드가 어디 있나

기능 하나가 폴더 하나다. 폴더 안에서는 이름이 역할을 가리킨다.

```text
src/shared/    discord.mjs · http.mjs — 모든 기능이 쓰는 것
src/store/     lib.mjs(순수) · asc.mjs · play.mjs(수집) · run.mjs(크론) · reply.mjs(답글 버튼)
src/status/    lib.mjs(순수) · source.mjs(수집) · run.mjs(크론)
src/metrics/   lib.mjs(순수) · amplitude.mjs · revenuecat.mjs · supabase.mjs(수집) · collect.mjs(조립)
               run.mjs(크론) · trigger.mjs(깨우기) · preview.mjs · sample.mjs(예시 숫자로 모양 확인)
src/feedback/  lib.mjs(순수) · replay.mjs(앰플리튜드 리플레이 찾기)
src/referral/  lib.mjs(순수) · risk.mjs(이상 징후 카드)
src/sentry/    lib.mjs(순수) · triage.mjs(landit-triage 분석 요청)
src/survey/    lib.mjs(순수)
api/           웹훅 수신 함수 — 위 순수 로직을 불러 쓴다
supabase/ sql/ 레퍼럴 웹훅·이상 징후 트리거, 지표용 읽기 전용 함수
scripts/       밀린 설문·피드백 일괄 전송, 앱 이모지 업로드
```

- `lib.mjs`는 네트워크를 타지 않는다. 테스트가 붙는 곳이 여기다.
- `run.mjs`는 크론 실행부다. 상태 파일을 읽고 비교하고 보내고 저장한다.
- 수집기(`asc.mjs`·`play.mjs`·`source.mjs`·`amplitude.mjs`·`revenuecat.mjs`·`supabase.mjs`)만 바깥과 통신한다.

## 로컬에서

```bash
node --test 'src/**/*.test.mjs'   # 단위 테스트

DISCORD_WEBHOOK_REVIEW=... DISCORD_WEBHOOK_UPDATE=... node src/store/run.mjs
DISCORD_WEBHOOK_DEPS=... node src/status/run.mjs
DISCORD_WEBHOOK_METRICS_DAILY=... node src/metrics/run.mjs daily
```

**디스코드 채널에 테스트 발송을 하지 않는다.** 팀원이 본다. 웹훅은 테스트용 채널 주소로 덮어쓴다.
상태 파일은 `.state/` 아래에 저장되고 `STATE_FILE`로 위치를 바꿀 수 있다.

`api/`나 `src/`를 고치면 머지와 별개로 `npx vercel deploy --prod`를 돌려야 반영된다. Vercel 프로젝트가 깃허브와 연결돼 있지 않아서다. 절차는 [docs/reply.md](docs/reply.md).

## 시크릿

GitHub Secrets와 Vercel 환경변수가 어디에 쓰이고 어느 문서를 보면 되는지는 [docs/secrets.md](docs/secrets.md)에 모아 뒀다. 운영 중 겪은 주의점도 거기 있다. 스토어 키 발급 과정은 [docs/key-setup.md](docs/key-setup.md).

## 왜 별도 레포인가

- 운영 도구는 앱 코드와 수명이 다르다. 여기가 깨져도 앱 빌드·배포는 무관하고, 반대도 마찬가지다.
- 퍼블릭 레포는 GitHub Actions가 무료 무제한이다. 크론이 팀 CI 한도를 건드리지 않는다.
- 백엔드·설문·Sentry처럼 앱 밖에서 오는 알림도 여기로 모인다.
