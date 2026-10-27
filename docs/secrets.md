# 시크릿과 환경변수

어떤 키가 어디에 있고, 어느 문서를 보면 되는지 한곳에 모았다. 발급 과정은 [key-setup.md](key-setup.md), 등록 명령은 각 기능 문서에 있다.

## GitHub Actions Secrets (크론 알림)

| 이름                                                | 쓰는 곳                   | 문서                         |
| --------------------------------------------------- | ------------------------- | ---------------------------- |
| `DISCORD_WEBHOOK_REVIEW` / `DISCORD_WEBHOOK_UPDATE` | 스토어 알림               | [key-setup.md](key-setup.md) |
| `ASC_ISSUER_ID` / `ASC_KEY_ID` / `ASC_PRIVATE_KEY`  | App Store Connect API 키  | [key-setup.md](key-setup.md) |
| `PLAY_SERVICE_ACCOUNT_JSON`                         | Play 서비스 계정 키       | [key-setup.md](key-setup.md) |
| `DISCORD_WEBHOOK_DEPS`                              | 서드파티 상태 알림        | [status.md](status.md)       |
| `AMPLITUDE_API_KEY` / `AMPLITUDE_SECRET_KEY`        | 지표 조회                 | [metrics.md](metrics.md)     |
| `REVENUECAT_API_KEY` / `REVENUECAT_PROJECT_ID`      | 구독 조회                 | [metrics.md](metrics.md)     |
| `DISCORD_WEBHOOK_METRICS_DAILY` / `..._WEEKLY`      | 지표 채널 웹훅            | [metrics.md](metrics.md)     |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY`              | 지표의 최고 스트릭 (선택) | [metrics.md](metrics.md)     |

크론 알림은 자기 Secrets가 하나라도 없으면 실행이 시작하지 않는다. (선택)이라 적힌 것만 예외로, 없으면 그 줄만 빠진다.

## Vercel 환경변수 (웹훅 수신)

| 이름                                                   | 용도                                     | 문서                       |
| ------------------------------------------------------ | ---------------------------------------- | -------------------------- |
| `DISCORD_PUBLIC_KEY`                                   | 디스코드 버튼 요청 서명 검증             | [reply.md](reply.md)       |
| `ASC_ISSUER_ID` / `ASC_KEY_ID` / `ASC_PRIVATE_KEY`     | 리뷰 답글 게시 (GitHub Secrets와 동일)   | [reply.md](reply.md)       |
| `PLAY_SERVICE_ACCOUNT_JSON`                            | 리뷰 답글 게시 (GitHub Secrets와 동일)   | [reply.md](reply.md)       |
| `FEEDBACK_WEBHOOK_SECRET` / `DISCORD_WEBHOOK_FEEDBACK` | 피드백 웹훅 검증·앱-피드백 채널 웹훅     | [feedback.md](feedback.md) |
| `AMPLITUDE_API_KEY` / `AMPLITUDE_SECRET_KEY`           | 피드백 카드의 리플레이 찾기              | [feedback.md](feedback.md) |
| `SURVEY_WEBHOOK_SECRET` / `DISCORD_WEBHOOK_SURVEY`     | 설문 웹훅 검증·유료화-전-설문 채널 웹훅  | [survey.md](survey.md)     |
| `REFERRAL_WEBHOOK_SECRET` / `DISCORD_WEBHOOK_REFERRAL` | 레퍼럴 웹훅 검증·초대 등록 채널 웹훅     | [referral.md](referral.md) |
| `SENTRY_CLIENT_SECRET` / `SENTRY_CHANNELS`             | Sentry 서명 검증·프로젝트별 채널 웹훅    | [sentry.md](sentry.md)     |
| `TRIAGE_DISPATCH_TOKEN`                                | (선택) landit-triage 분석 요청           | [sentry.md](sentry.md)     |
| `CRON_SECRET` / `GH_WORKFLOW_TOKEN`                    | 버셀 크론 검증·깃허브 워크플로 실행 요청 | [metrics.md](metrics.md)   |

ASC 키는 GitHub Secrets와 Vercel 양쪽에 있다. 키를 바꾸면 둘 다 교체하고 Vercel은 재배포한다.

## 운영 주의

- **ASC 키는 애플 개발자 팀에 묶인다.** 앱을 다른 팀으로 이전하면 옛 키로는 403·404가 나는데, 워크플로는 "수집 실패"만 로그에 남긴 채 success로 끝난다. 2026-09 계정 이전 때 열흘간 애플 알림이 조용히 빠졌다. 이전 뒤에는 새 팀에서 키를 다시 발급해 GitHub Secrets·Vercel 둘 다 교체한다.
- **애플 알림이 한동안 없으면 Actions 로그를 본다.** 실행 마지막 줄의 `수집 실패: ...`가 그 신호다. 성공 배지만 믿지 않는다.
- **지표가 아침에 아예 안 오면** 조회가 아니라 발송이 막힌 것이다. 조회 실패는 실패대로 알리게 돼 있다.
