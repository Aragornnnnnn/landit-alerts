# landit-alerts

랜딧 앱의 스토어 소식·설문 응답·Sentry 이슈를 디스코드로 알린다.
스토어는 GitHub Actions가 30분마다 확인하고, 설문과 Sentry는 웹훅으로 받는다. 따로 두는 서버는 없다.

## 무엇을 알리나

| 알림                       | 채널                           | 방식                  |
| -------------------------- | ------------------------------ | --------------------- |
| 새 리뷰 (양쪽 스토어)      | `#앱-리뷰`                     | 30분마다 확인         |
| 새 버전 공개 (양쪽 스토어) | `#앱-소식`                     | 30분마다 확인         |
| 애플 심사 통과·거절        | `#앱-소식`                     | 30분마다 확인         |
| 설문 응답                  | `#유료화-전-설문`              | 슈퍼베이스 웹훅       |
| Sentry 새 이슈             | `#sentry-web` `#sentry-mobile` | Sentry 내부 연동 웹훅 |

디스코드 카테고리는 뮤트 단위다. 🚨 장애 알림(sentry-web·sentry-mobile·sentry-server·grafana) · 💰 결제·구독(revenuecat) · 📣 유저 목소리(앱-리뷰·유료화-전-설문) · 🚀 배포·스토어(앱-소식).
이 레포가 보내는 건 위 표의 다섯 가지다. sentry-server·grafana·revenuecat은 여기서 보내지 않는다.

리뷰 알림에서는 버튼으로 바로 답글을 달 수 있다. [docs/reply.md](docs/reply.md) 참고.
설문은 [docs/survey.md](docs/survey.md), Sentry는 [docs/sentry.md](docs/sentry.md)에 세팅 과정이 있다.

별점만 남긴 평가는 스토어가 개별 조회를 막아둬서 알림 대상이 아니다.
평균 평점 알림도 두지 않는다. 공식 API가 없어 값이 불안정하기 때문이다.
Play 심사 완료 알림은 구글이 API를 제공하지 않아 만들 수 없다.

## 알림 예시

새 리뷰. 별점이 먼저 오고 제목이 아래다.
왼쪽 색 막대는 별점을 따라간다 (4-5 초록, 3 노랑, 1-2 빨강).

```text
🍎 App Store
⭐⭐⭐⭐⭐
영어 회화 연습에 딱이에요
출퇴근길에 부담 없이 한 판씩 하기 좋아요.
닉네임                             ← Android는 v1.4.2 · 기기 이름 · OS 추가
```

새 버전 공개. 해당 스토어 링크만 넣는다.

```text
🍎 App Store
🚀 랜딧 1.5.0 공개됨
릴리즈 노트
- ...
[App Store에서 보기]
```

심사 결과.

```text
🍎 App Store
✅ 1.5.0 심사 통과 — 출시 대기 중
출시 버튼을 누르면 배포됩니다. [App Store Connect 열기]
```

🍎/🤖 자리에는 실제 스토어 로고가 표시된다.
저평점이어도 멘션은 하지 않는다. 색으로만 구분한다.

## 어떻게 동작하나

### 30분마다 확인하는 알림 (스토어)

`src/run.mjs`가 30분마다 실행된다.
스토어에 현재 상태를 물어보고, 지난 실행의 상태(Actions cache)와 비교한다.
달라진 것만 디스코드 웹훅으로 보낸다.

- 첫 실행은 기준점만 저장하고 아무것도 보내지 않는다.
- 리뷰는 ID로 비교하므로 같은 리뷰가 두 번 알림되지 않는다.
- 수집원 하나가 실패해도 나머지 알림은 정상 동작한다.
- 버전은 높아졌을 때만 알린다. 스토어 CDN이 배포 직후 옛 버전을 섞어 응답해도 반복 알림이 없다.

알림별 판정 조건과 반복 알림 방어의 배경은 [docs/alert-flow.md](docs/alert-flow.md)에 있다.

데이터는 전부 공식 인증 API에서 가져온다.
공개 엔드포인트(RSS·lookup·페이지 파싱)는 캐시 흔들림 문제로 폐기했다 ([배경](docs/alert-flow.md)).

| 데이터                   | 출처                      |
| ------------------------ | ------------------------- |
| App Store 리뷰·버전·심사 | App Store Connect API     |
| Play 리뷰·버전(트랙)     | Google Play Developer API |

### 웹훅으로 받는 알림 (설문·Sentry·리뷰 답글 버튼)

`api/` 아래 함수가 팀 Vercel의 landit-alerts 프로젝트(`https://landit-alerts.vercel.app`)에서 돈다.
외부가 우리 주소로 보내면 검증하고 디스코드 형식으로 바꿔 보낸다.

| 함수                   | 받는 것                        | 검증                          |
| ---------------------- | ------------------------------ | ----------------------------- |
| `api/interactions.mjs` | 디스코드 버튼·모달 (리뷰 답글) | Ed25519 서명 + 5분 타임스탬프 |
| `api/survey.mjs`       | 슈퍼베이스 Database Webhook    | `x-survey-secret` 헤더        |
| `api/sentry.mjs`       | Sentry 알림 규칙 액션          | HMAC 서명 (Client Secret)     |

`api/`나 `src/`를 고치면 GitHub 푸시와 별개로 `npx vercel deploy --prod`를 돌려야 반영된다. 절차는 [docs/reply.md](docs/reply.md).

## Secrets

### GitHub Actions (스토어 알림)

전부 필수다. 하나라도 없으면 실행이 시작하지 않는다.

| 이름                                               | 용도                     |
| -------------------------------------------------- | ------------------------ |
| `DISCORD_WEBHOOK_REVIEW`                           | 리뷰 채널 웹훅           |
| `DISCORD_WEBHOOK_UPDATE`                           | 앱-소식 채널 웹훅        |
| `ASC_ISSUER_ID` / `ASC_KEY_ID` / `ASC_PRIVATE_KEY` | App Store Connect API 키 |
| `PLAY_SERVICE_ACCOUNT_JSON`                        | Play 서비스 계정 키      |

발급 절차는 [docs/key-setup.md](docs/key-setup.md)에 있다.

### Vercel 환경변수 (웹훅 수신)

| 이름                                               | 용도                                    | 문서                        |
| -------------------------------------------------- | --------------------------------------- | --------------------------- |
| `DISCORD_PUBLIC_KEY`                               | 디스코드 버튼 요청 서명 검증            | [reply.md](docs/reply.md)   |
| `ASC_ISSUER_ID` / `ASC_KEY_ID` / `ASC_PRIVATE_KEY` | 리뷰 답글 게시 (GitHub Secrets와 동일)  | [reply.md](docs/reply.md)   |
| `PLAY_SERVICE_ACCOUNT_JSON`                        | 리뷰 답글 게시 (GitHub Secrets와 동일)  | [reply.md](docs/reply.md)   |
| `SURVEY_WEBHOOK_SECRET` / `DISCORD_WEBHOOK_SURVEY` | 설문 웹훅 검증·유료화-전-설문 채널 웹훅 | [survey.md](docs/survey.md) |
| `SENTRY_CLIENT_SECRET` / `SENTRY_CHANNELS`         | Sentry 서명 검증·프로젝트별 채널 웹훅   | [sentry.md](docs/sentry.md) |

ASC 키는 GitHub Secrets와 Vercel 양쪽에 있다. 키를 바꾸면 둘 다 교체하고 Vercel은 재배포한다.

## 운영 주의

- **ASC 키는 애플 개발자 팀에 묶인다.** 앱을 다른 팀으로 이전하면 옛 키로는 403·404가 나고, 워크플로우는 "수집 실패"만 로그에 남긴 채 success로 끝난다. 2026-09 계정 이전 때 열흘간 애플 알림이 조용히 빠졌다. 이전 뒤에는 새 팀에서 키를 다시 발급해 GitHub Secrets·Vercel 둘 다 교체한다. [docs/key-setup.md](docs/key-setup.md).
- **애플 알림이 한동안 없으면 Actions 로그를 본다.** 실행 마지막 줄의 `수집 실패: ...`가 그 신호다. 성공 배지만 믿지 않는다.
- 디스코드 채널에 테스트 발송을 하지 않는다. 팀원이 본다.

## 로컬 실행

```bash
node --test src/*.test.mjs   # 단위 테스트
DISCORD_WEBHOOK_REVIEW=... DISCORD_WEBHOOK_UPDATE=... node src/run.mjs
```

상태 파일은 `.state/store-alerts.json`에 저장된다.
`STATE_FILE` 환경변수로 위치를 바꿀 수 있다.

웹훅 연결 전에 쌓인 설문 응답은 `scripts/survey-backfill.mjs`로 한 번에 보낸다. [docs/survey.md](docs/survey.md).

## 왜 별도 레포인가

- 운영 도구는 앱 코드와 수명이 다르다. landit-fe는 PR과 리뷰를 거치지만, 여기는 main에 바로 커밋한다.
- 서로 영향이 없다. 여기가 깨져도 앱 빌드·배포는 무관하고, 반대도 마찬가지다.
- 퍼블릭 레포는 GitHub Actions가 무료 무제한이다. 30분 cron이 팀 CI 한도를 건드리지 않는다.
- 백엔드·설문·Sentry처럼 앱 밖에서 오는 알림도 여기로 모은다.
