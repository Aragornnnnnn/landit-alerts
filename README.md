# landit-alerts

랜딧 운영에 필요한 알림을 디스코드로 보낸다. 스토어 리뷰와 릴리즈, 유저 피드백, 서드파티 장애, 아침 지표가 여기서 나간다.

따로 띄워 둔 서버는 없다. 주기적으로 확인하는 것은 GitHub Actions 크론이 돌리고, 밖에서 들어오는 웹훅은 Vercel 함수가 받는다.

## 보내는 알림

| 알림                       | 채널                           | 어떻게                |
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

`#웹-상태`와 `#revenuecat`은 여기서 보내지 않는다. UptimeRobot과 RevenueCat이 직접 보낸다.
디스코드에서는 카테고리 단위로 뮤트한다. 장애, 결제·구독, 유저 목소리, 지표, 배포·스토어.

알림마다 문서가 하나씩 있다. 세팅 과정, 카드 형식, 판정 조건은 거기 있다.

| 문서                                     | 내용                                             |
| ---------------------------------------- | ------------------------------------------------ |
| [docs/reply.md](docs/reply.md)           | 리뷰 카드의 답글 버튼, Vercel 세팅과 배포        |
| [docs/feedback.md](docs/feedback.md)     | 편지함 피드백 카드와 리플레이 링크               |
| [docs/survey.md](docs/survey.md)         | 설문 응답                                        |
| [docs/referral.md](docs/referral.md)     | 친구 초대 등록과 이상 징후                       |
| [docs/sentry.md](docs/sentry.md)         | Sentry 새 이슈와 landit-triage 분석 요청         |
| [docs/status.md](docs/status.md)         | 서드파티 서비스 상태                             |
| [docs/metrics.md](docs/metrics.md)       | 일일·주간 지표의 정의와 형식                     |
| [docs/uptime.md](docs/uptime.md)         | 웹 접속 감시                                     |
| [docs/alert-flow.md](docs/alert-flow.md) | 스토어 알림의 판정 조건과 반복 알림 방어         |
| [docs/cards.md](docs/cards.md)           | 카드가 디스코드에서 어떻게 보이는지              |
| [docs/secrets.md](docs/secrets.md)       | GitHub Secrets와 Vercel 환경변수 목록, 운영 주의 |
| [docs/key-setup.md](docs/key-setup.md)   | App Store Connect 키와 Play 서비스 계정 발급     |

## 동작

스토어와 서드파티 상태는 크론이 현재 상태를 받아서 지난 실행 때 저장한 상태(Actions 캐시)와 비교한다. 달라진 것만 보내고, 첫 실행은 기준점만 저장한다.

지표는 버셀 크론이 매일 아침 깃허브 워크플로를 깨운다. 워크플로가 앰플리튜드, RevenueCat, 슈퍼베이스에 어제와 그제 값을 물어 증감과 함께 보낸다. 조회에 실패하면 실패했다고 보낸다.

피드백, 설문, 친구 초대, Sentry는 외부가 `https://landit-alerts.vercel.app/api/...`로 보낸다. 함수가 서명이나 비밀 헤더를 확인한 뒤 디스코드 카드로 바꿔 보낸다.

데이터는 전부 인증이 필요한 공식 API에서 받는다. RSS나 lookup 같은 공개 엔드포인트는 캐시가 흔들려서 쓰지 않는다.

## 코드

기능 하나에 폴더 하나다.

```text
src/shared/    discord.mjs, http.mjs                         공통
src/store/     리뷰, 릴리즈, 심사 (asc, play, run, reply)
src/status/    서드파티 상태
src/metrics/   지표 (amplitude, revenuecat, supabase 수집 / collect 조립 / run, trigger)
src/feedback/  피드백 카드. replay.mjs가 앰플리튜드 리플레이를 찾는다
src/referral/  친구 초대 카드. risk.mjs가 이상 징후 카드
src/sentry/    Sentry 카드. triage.mjs가 landit-triage에 분석 요청
src/survey/    설문 카드
api/           Vercel 웹훅 수신 함수
supabase/ sql/ 레퍼럴 트리거, 지표용 읽기 전용 함수
scripts/       밀린 설문·피드백 일괄 전송, 앱 이모지 업로드
```

폴더 안에서 `lib.mjs`는 네트워크를 타지 않는 순수 로직이고 테스트는 여기에 붙는다. `run.mjs`가 크론 실행부다. 바깥과 통신하는 파일은 수집기(`asc.mjs`, `play.mjs`, `source.mjs`, `amplitude.mjs`, `revenuecat.mjs`, `supabase.mjs`)뿐이다.

## 로컬에서

```bash
node --test 'src/**/*.test.mjs'
```

크론을 직접 돌려 보려면 웹훅 주소를 테스트 채널로 바꿔서 돌린다. 실제 채널에 테스트 발송을 하면 팀원이 본다.

```bash
DISCORD_WEBHOOK_REVIEW=... DISCORD_WEBHOOK_UPDATE=... node src/store/run.mjs
DISCORD_WEBHOOK_DEPS=... node src/status/run.mjs
DISCORD_WEBHOOK_METRICS_DAILY=... node src/metrics/run.mjs daily
```

상태 파일은 `.state/`에 쌓이고 `STATE_FILE`로 위치를 바꿀 수 있다.

## 배포

GitHub Actions 쪽은 머지하면 끝이다. Vercel 쪽(`api/`, `src/`)은 프로젝트가 깃허브와 연결돼 있지 않아서 머지한 뒤 직접 올린다.

```bash
npx vercel deploy --prod
```

시크릿과 환경변수는 [docs/secrets.md](docs/secrets.md)에 있다.

## 앱 레포와 따로 두는 이유

운영 도구는 앱과 수명이 다르고, 여기가 깨져도 앱 배포에 영향이 없어야 해서다. 퍼블릭 레포라 Actions 크론이 팀 CI 한도를 쓰지 않는 것도 있다.

## OpenAI 일일 잔액·비용

매일 한국 시간 오전 10시의 Safari 잔액 확인과 공식 Costs API 키별 비용 보고는 [OpenAI 보고 설정](docs/openai-report.md)을 따른다. 실행 코드는 `src/openai/`, 비밀값 등록은 `scripts/setup-openai.py`이며 예약 실행은 Codex 자동화에서 관리한다.
