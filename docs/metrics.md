# 일일·주간 지표 알림

매일 아침 9시(KST)에 전날 지표를 `#일일-지표`로, 월요일엔 이어서 지난주 지표를 `#주간-지표`로 보낸다.
지표를 보려고 앰플리튜드에 들어가지 않아도 되게, 훑어 읽을 만큼만 담는다.

## 형식

메시지 하나가 ANSI 코드 블록 하나다. 디스코드에서 증감을 초록(+)·빨강(−)으로 칠할 수 있는 유일한 문법이라서다. 휴대폰에선 색만 빠지고 부호는 남는다.

- 블록 제목만 굵게, 이모지도 제목에만. 불릿은 세 칸 들여쓰기, 부모를 쪼개는 줄은 여섯 칸.
- 괄호 없는 `+9`·`−2`는 전일(전주) 대비 절대 증감. 변화가 0이거나 비교할 이전 값이 없으면 안 붙는다.
- 제목 줄이 전일 대비 50% 이상, 그리고 5명 이상 튀면 앞에 ⚠️. 불릿엔 붙지 않는다.
- 사람 수는 어디든 "명", 표현은 "개", 스몰톡은 "판". 블록 제목 숫자는 불릿의 합이다.

메시지 예시와 입력 데이터 모양은 [src/metrics/preview.mjs](../src/metrics/preview.mjs)가 정본이다.

## 지표 정의

앰플리튜드 값은 전부 **팀 계정 24개 제외 · 모바일(ios/android)만**이다. 조건은 `src/metrics/amplitude.mjs`의 `STANDARD_SEGMENT`에 있고, landit-fe `.claude/skills/amplitude/SKILL.md`의 표준 조건과 같다. 프로젝트 타임존이 Asia/Seoul이라 날짜는 KST 그대로 넣는다.

| 줄                          | 정의                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 활성                        | 이벤트를 하나라도 남긴 유저(`_active`). 유료는 유저 속성 `is_premium=true`, 무료는 활성 − 유료                          |
| 가입                        | Onboarding Completed 유저                                                                                               |
| 어디서 들어왔나             | 첫 화면 Page Viewed의 `entry_campaign`. `streak_widget`은 위젯, 나머지는 알림. 직접 = 활성 − 알림 − 위젯                |
| 시나리오 완료·하다가 그만둠 | Scenario Talk Completed / Abandoned 유저                                                                                |
| 시나리오 표현               | Expression Completed 중 `scenario_id`가 있는 것. 분포는 유저별 횟수, 0개 = 유료로 시나리오는 끝냈지만 표현을 안 한 사람 |
| 스몰톡                      | Small Talk Completed. 턴은 `turn_count` 평균, 말한 시간은 `speaking_duration_ms` 평균·최소·최대                         |
| 스몰톡 표현                 | Expression Completed 중 `session_id`가 있는 것. 판마다 표현 수가 달라 마지막 칸은 "3개 이상"                            |
| D1 리텐션                   | 그제 가입(Onboarding Completed)한 사람 중 어제 활성. 리텐션 API 응답의 셋째 칸                                          |
| 주간 리텐션                 | 지지난주 가입자 중 지난주에 활성. 지난주 가입자는 아직 한 주가 안 지나 못 쓴다                                          |
| 온보딩 완료·첫 시나리오까지 | 퍼널 API. Onboarding Started → Completed, Onboarding Completed → Scenario Talk Completed (전환 창 7일)                  |
| 구독 중                     | RevenueCat. 월간·연간 결제는 `actives` 차트, 무료체험은 `trials` 차트(상품별). 프로모션은 아래 참고                     |

유료 블록의 괄호 비율은 유료 활성 대비 참여 비율이고, "평균"은 참여한 사람만으로 나눈 값이다.

주간 시나리오 완료 분포는 앰플리튜드 frequency 버킷(1, 2, 3, 4, 5, 6~~10, 11~~20…)을 그대로 쓴다. 지난 날 카드도 할 수 있어 개수가 일수보다 크다.

### 프로모션은 왜 전수 조회인가

RevenueCat 차트는 유료·체험만 세고 우리가 부여한 프로모션은 안 잡는다. 그래서 고객 목록을 전부 돌며 구독을 읽어, `store=promotional`·프로덕션·그날 끝(KST)에 살아 있던 것만 센다.
고객 수만큼 호출한다(466명 기준 34초). 수천 명이 되면 몇 분이 걸리지만 하루 한 번이라 두었다. 상품 목록 권한 없이 되게 상품 구분은 차트에 맡겼다.

## 구조

- `src/metrics/lib.mjs` — 메시지 조립(순수). `buildDailyMessage`·`buildWeeklyMessage`. 테스트가 붙는 곳
- `src/metrics/amplitude.mjs` — 앰플리튜드 Dashboard REST. 동시 4개 제한과 429 재시도가 여기 있다
- `src/metrics/revenuecat.mjs` — RevenueCat 차트와 고객 전수 조회
- `src/metrics/collect.mjs` — 두 수집기를 불러 입력 모양을 만든다. 이벤트 이름·필터는 여기 `EVENT` 표 한 곳
- `src/metrics/run.mjs` — 실행부. `daily|weekly [기준일]`. 조회가 하나라도 실패하면 보내지 않는다
- `src/metrics/preview.mjs` — 예시 숫자로 모양만 확인할 때
- `.github/workflows/metrics.yml` — 매일 UTC 0시. 월요일이면 주간 잡이 이어서 돈다

전일·전주 값은 저장하지 않고 같은 조회를 날짜만 바꿔 다시 부른다. 상태 파일이 없어 캐시 복원 단계도 없다.

## 세팅 과정

1. **디스코드 웹훅** — `#일일-지표`, `#주간-지표` 각 채널 편집 > 연동 > 웹후크. 이름 "랜딧 지표", 아바타는 토스페이스 📊.
2. **앰플리튜드** — 설정 > Projects > production의 API Key·Secret Key. 새로 만들지 않고 프로젝트에 붙은 한 쌍을 쓴다.
3. **RevenueCat** — 프로젝트 > API keys > v2 시크릿 키. 권한은 Charts metrics Read, Customer information Read 둘만. 프로젝트 id는 대시보드 주소의 `/projects/<id>/`.
4. **GitHub Secrets** — `AMPLITUDE_API_KEY` `AMPLITUDE_SECRET_KEY` `REVENUECAT_API_KEY` `REVENUECAT_PROJECT_ID` `DISCORD_WEBHOOK_METRICS_DAILY` `DISCORD_WEBHOOK_METRICS_WEEKLY`.
5. **첫 실행** — 크론이 돌 때까지 기다린다. 손으로 돌리면 실채널로 나가니 Actions > metrics > Run workflow는 확인이 필요할 때만.

로컬에서 모양만 보려면 `DISCORD_WEBHOOK_METRICS_DAILY=<테스트 웹훅> node --env-file=~/.landit-discord.env src/metrics/run.mjs daily`. 명령줄 환경변수가 파일보다 우선이라 실채널 웹훅은 쓰이지 않는다.

## 운영 주의

- **조회 실패는 침묵이다.** 앰플리튜드나 RevenueCat이 한 번이라도 실패하면 메시지가 안 나간다. 아침에 안 오면 Actions 로그부터 본다.
- 앰플리튜드는 키당 동시 5개, 시간당 360건 한도. 일일이 조회 약 35건, 주간 약 45건이라 여유가 있지만 다른 스크립트와 같은 키를 동시에 쓰면 429가 난다.
- `is_premium`은 9/11 이후 로그인한 유저에게만 있어 무료를 `is_premium=false`로 뽑으면 빠진다. 활성 − 유료로 계산하는 이유다.
- REST에선 커스텀 유저 속성이 `gp:is_premium`처럼 `gp:` 접두사다. MCP와 다르다.
- 새 알림 캠페인은 `lib.mjs`의 `CAMPAIGN_LABELS`에 이름을 더한다. 안 더해도 캠페인 이름 그대로 나간다.
- 무료 체험이 결제로 넘어가기 시작하면 "결제 중" 줄이 채워진다. 그 전까지 0명은 정상이다.
