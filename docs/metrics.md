# 일일·주간 지표 알림

매일 아침 9시(KST)에 전날 지표를 `#일일-지표`로, 월요일엔 이어서 지난주 지표를 `#주간-지표`로 보낸다.
지표를 보려고 앰플리튜드에 들어가지 않아도 되게, 훑어 읽을 만큼만 담는다.

## 쉽게 말하면

1. 앱에서 뭔가 할 때마다 쪽지(이벤트)가 하나씩 앰플리튜드 창고로 날아간다. 「시나리오 완료」「표현 완료」처럼 이름이 붙어 있고, 이름은 landit-fe `packages/analytics/src/events.ts`에 정해져 있다.
2. 창고엔 질문 창구(Dashboard REST API)가 있다. "9월 20일에 「시나리오 완료」 쪽지 남긴 사람 몇 명?"이라고 물으면 숫자 하나가 돌아온다. 물을 때마다 팀 계정과 웹 브라우저 쪽지는 빼 달라는 조건을 붙인다.
3. 질문은 여섯 가지뿐이다. 몇 명(uniques), 몇 번(totals), 사람마다 몇 번(frequency 분포), 속성의 평균·최소·최대(PROPAVG·PROPMIN·PROPMAX), 돌아왔나(리텐션), 순서대로 했나(퍼널). 메시지의 줄마다 이 중 하나를 고른 질문지가 `src/metrics/collect.mjs`의 `EVENT` 표다.
4. 같은 질문을 어제와 그제로 두 번 하고 빼면 증감(+9)이 된다. 창고가 과거를 그대로 기억하므로 어제 값을 저장하지 않는다.
5. 구독은 RevenueCat이라는 다른 창고다. 월간·연간·체험은 차트에 묻고, 프로모션만 고객 명단을 한 명씩 열어 센다.
6. GitHub Actions가 매일 9시에 질문을 전부 던지고 답을 한 장으로 적어 디스코드 웹훅으로 보낸다. 월요일엔 주간 편지도 한 장 더. 질문 하나라도 답을 못 받으면 보내지 않는다.

이벤트 이름이 바뀌면 3번의 질문지 표만 고친다.

## 형식

메시지 하나가 ANSI 코드 블록 하나다. 디스코드에서 증감을 초록(+)·빨강(−)으로 칠할 수 있는 유일한 문법이라서다. 휴대폰에선 색만 빠지고 부호는 남는다.

- 블록 제목만 굵게, 이모지도 제목에만. 불릿은 세 칸 들여쓰기, 부모를 쪼개는 줄은 여섯 칸.
- 괄호 없는 `+9`·`−2`는 전일(전주) 대비 절대 증감. 변화가 0이거나 비교할 이전 값이 없으면 안 붙는다.
- 제목 줄이 전일 대비 50% 이상, 그리고 5명 이상 튀면 앞에 ⚠️. 불릿엔 붙지 않는다.
- 사람 수는 어디든 "명", 표현은 "개", 스몰톡은 "판". 블록 제목 숫자는 불릿의 합이다.

메시지 예시와 입력 데이터 모양은 [src/metrics/preview.mjs](../src/metrics/preview.mjs)가 정본이다.

## 지표 정의

앰플리튜드 값은 전부 **팀 계정 24개 제외 · 모바일(ios/android)만**이다. 조건은 `src/metrics/amplitude.mjs`의 `STANDARD_SEGMENT`에 있고, landit-fe `.claude/skills/amplitude/SKILL.md`의 표준 조건과 같다. 프로젝트 타임존이 Asia/Seoul이라 날짜는 KST 그대로 넣는다.

| 줄                          | 정의                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 활성                        | 이벤트를 하나라도 남긴 유저(`_active`). 유료는 유저 속성 `is_premium=true`, 무료는 활성 − 유료                                                                                  |
| 가입                        | Onboarding Completed 유저                                                                                                                                                       |
| 어디서 들어왔나             | 첫 화면 Page Viewed의 `entry_campaign`. `streak_widget`은 위젯, 나머지는 알림. 직접 = 활성 − 알림 − 위젯                                                                        |
| 시나리오 완료·하다가 그만둠 | Scenario Talk Completed / Abandoned 유저                                                                                                                                        |
| 시나리오 표현               | Expression Completed 중 `scenario_id`가 있는 것. 분포는 유저별 횟수, 0개 = 유료로 시나리오는 끝냈지만 표현을 안 한 사람(두 이벤트가 자정을 걸쳐 갈리면 어긋날 수 있어 추정치다) |
| 스몰톡                      | Small Talk Completed. 턴은 `turn_count` 평균, 말한 시간은 `speaking_duration_ms` 평균·최소·최대                                                                                 |
| 스몰톡 표현                 | Expression Completed 중 `session_id`가 있는 것. 판마다 표현 수가 달라 마지막 칸은 "3개 이상"                                                                                    |
| D1 리텐션                   | 그제 가입(Onboarding Completed)한 사람 중 어제 활성. 리텐션 API 응답의 셋째 칸                                                                                                  |
| 주간 리텐션                 | 지지난주 가입자 중 지난주에 활성. 지난주 가입자는 아직 한 주가 안 지나 못 쓴다                                                                                                  |
| 온보딩 완료·첫 시나리오까지 | 퍼널 API. Onboarding Started → Completed, Onboarding Completed → Scenario Talk Completed (전환 창 7일)                                                                          |
| 구독 중                     | RevenueCat. 월간·연간 결제는 `actives` 차트, 무료체험은 `trials` 차트(상품별). 프로모션은 아래 참고                                                                             |

유료 블록의 괄호 비율은 유료 활성 대비 참여 비율이고, "평균"은 참여한 사람만으로 나눈 값이다.

주간 시나리오 완료 분포는 앰플리튜드 frequency 버킷(1, 2, 3, 4, 5, 6~~10, 11~~20…)을 그대로 쓴다. 지난 날 카드도 할 수 있어 개수가 일수보다 크다.

### 프로모션은 왜 전수 조회인가

RevenueCat 차트는 유료·체험만 세고 우리가 부여한 프로모션은 안 잡는다. 그래서 고객 목록을 전부 돌며 구독을 읽어, `store=promotional`·프로덕션·그날 끝(KST)에 살아 있던 것만 센다.
고객 수만큼 호출한다(466명 기준 34초). 수천 명이 되면 몇 분이 걸리지만 하루 한 번이라 두었다. 상품 목록 권한 없이 되게 상품 구분은 차트에 맡겼다.

## 구조

- `src/metrics/lib.mjs` — 메시지 조립(순수). `buildDailyMessage`·`buildWeeklyMessage`
- `src/metrics/amplitude.mjs` — 앰플리튜드 Dashboard REST. 동시 4개 제한과 재시도가 여기 있다. 응답을 숫자로 옮기는 순수 함수도 같이 둔다(응답 모양이 바뀌면 같이 바뀌므로)
- `src/metrics/revenuecat.mjs` — RevenueCat 차트와 고객 전수 조회
- `src/metrics/collect.mjs` — 두 수집기를 불러 입력 모양을 만든다. 이벤트 이름·필터는 여기 `EVENT` 표 한 곳
- `src/metrics/run.mjs` — 실행부. `daily|weekly [기준일]`
- `src/metrics/sample.mjs` — 예시 숫자. 입력 데이터 모양의 정본이고 테스트와 preview가 같이 쓴다
- `src/metrics/preview.mjs` — 예시 숫자로 모양만 확인할 때
- `src/metrics/trigger.mjs` · `api/metrics-cron.mjs` — 버셀 크론이 깃허브를 깨우는 통로
- `.github/workflows/metrics.yml` — 잡 하나 안에서 일일 step, 월요일이면 주간 step이 이어진다

전일·전주 값은 저장하지 않고 같은 조회를 날짜만 바꿔 다시 부른다. 상태 파일이 없어 캐시 복원 단계도 없다. 다만 비교에 쓰는 줄은 네댓 개뿐이라 이전 기간은 `collectDailyBaseline`·`collectWeeklyBaseline`으로 그 줄만 부른다.

## 누가 깨우나

**버셀 크론이 주 경로다.** 매일 KST 9시대에 버셀이 `api/metrics-cron`을 부르고, 그 함수가 깃허브에 "지금 돌려"라는 실행 요청만 보낸다. 일하는 곳은 그대로 깃허브 Actions다.

깃허브 자체 예약을 안 쓰는 이유가 있다. 이 레포는 예약 실행이 심하게 밀린다 — 15분·30분 크론이 실제로는 평균 195분 간격으로 돌고, 2026-09-21 첫 발송은 아예 건너뛰었다. 반면 실행 요청(dispatch) 경로는 몇 초 만에 시작한다.

무료 요금제라 버셀도 분까지는 못 맞춘다. `0 0 * * *`로 적어도 KST 9시에서 9시 59분 사이 아무 때나 깨운다. 분 단위가 필요해지면 외부 크론 서비스로 같은 요청을 보내면 된다.

워크플로에 남은 `schedule`(UTC 2시 12분)은 버셀이 실패했을 때의 예비책이다. 늦게 도착해도 상관없다 — 이미 보낸 기간이면 아무것도 하지 않는다.

**같은 기간은 두 번 보내지 않는다.** 마지막으로 보낸 기간을 `.state/metrics.json`에 적어 두고(Actions 캐시), 같은 기간이면 조회도 하지 않고 끝낸다. 버셀 크론은 같은 실행을 두 번 부를 수 있고, 늦은 예비책이 겹칠 수도 있어서다.

## 조회가 실패하면

- **앰플리튜드가 실패하면** 지표를 못 만든다. 그 자리에 `⚠️ 일일 지표를 못 가져왔어요`와 이유를 대신 보낸다. 침묵하면 지표가 0인 건지 봇이 죽은 건지 구분이 안 되기 때문이다.
- **RevenueCat만 실패하면** 앰플리튜드 줄은 그대로 보내고 구독 블록 자리에 `💳 구독 정보를 못 가져왔어요` 한 줄만 들어간다. 출처가 갈려 있어 서로 계산에 안 엮인다.
- 한도 초과(429)와 일시 장애(5xx)·네트워크 끊김은 쉬었다 다시 부른다. 앰플리튜드는 5분 비용 창을 넘길 만큼(최대 3분) 기다리고, RevenueCat은 응답이 알려 준 대기 시간을 따른다.

## 세팅 과정

1. **디스코드 웹훅** — `#일일-지표`, `#주간-지표` 각 채널 편집 > 연동 > 웹후크. 이름 "랜딧 지표", 아바타는 토스페이스 📊.
2. **앰플리튜드** — 설정 > Projects > production의 API Key·Secret Key. 새로 만들지 않고 프로젝트에 붙은 한 쌍을 쓴다.
3. **RevenueCat** — 프로젝트 > API keys > v2 시크릿 키. 권한은 Charts metrics Read, Customer information Read 둘만. 프로젝트 id는 대시보드 주소의 `/projects/<id>/`.
4. **GitHub Secrets** — `AMPLITUDE_API_KEY` `AMPLITUDE_SECRET_KEY` `REVENUECAT_API_KEY` `REVENUECAT_PROJECT_ID` `DISCORD_WEBHOOK_METRICS_DAILY` `DISCORD_WEBHOOK_METRICS_WEEKLY`.
5. **깃허브 토큰** — 이 레포의 Actions 실행 권한만 가진 fine-grained 토큰(Actions: Read and write)을 만들어 버셀 환경변수 `GH_WORKFLOW_TOKEN`에 넣는다.
6. **버셀 크론 비밀값** — 버셀 환경변수 `CRON_SECRET`에 아무 긴 문자열을 넣는다. 버셀이 크론 요청에 이 값을 실어 보내고, 함수는 그게 맞을 때만 움직인다. 없으면 아무나 주소를 눌러 알림을 쏠 수 있다.
7. **배포** — `npx vercel deploy --prod`. `vercel.json`의 크론은 프로덕션 배포에만 붙는다.
8. **첫 실행** — 크론이 돌 때까지 기다린다. 손으로 돌리면 실채널로 나가니 Actions > metrics > Run workflow는 확인이 필요할 때만.

로컬에서 모양만 보려면 `DISCORD_WEBHOOK_METRICS_DAILY=<테스트 웹훅> node --env-file=~/.landit-discord.env src/metrics/run.mjs daily`. 명령줄 환경변수가 파일보다 우선이라 실채널 웹훅은 쓰이지 않는다. 실제 조회 없이 배치만 보려면 같은 방식으로 `src/metrics/preview.mjs`.

## 운영 주의

- **깃허브 예약은 못 믿는다.** 이 레포의 15분·30분 크론이 실제로는 평균 195분 간격으로 돈다. 정각을 피하는 것만으로는 부족해서 버셀이 깨우게 바꿨다. 그래도 아침에 안 오면 Actions에서 Run workflow로 손으로 돌린다(mode=daily 또는 weekly).

- **아침에 아무것도 안 오면 조회가 아니라 발송이 막힌 것이다.** 조회 실패는 실패대로 알리게 돼 있으므로, 채널이 완전히 조용하면 웹훅과 워크플로를 본다.
- 앰플리튜드는 키당 동시 5개, 시간당 360건, 5분당 비용 한도가 있다. 일일 약 21건, 주간 약 24건이라 여유가 있지만 다른 스크립트와 같은 키를 동시에 쓰면 429가 난다. group_by가 붙는 조회(유입·말한 시간)가 비용이 크다.
- RevenueCat 고객 전수 조회는 고객 수만큼 호출한다. 수천 명이 되면 분당 한도에 걸려 느려지므로, 그때는 웹훅으로 프로모션 부여·만료를 쌓는 쪽으로 바꾼다.
- `is_premium`은 9/11 이후 로그인한 유저에게만 있어 무료를 `is_premium=false`로 뽑으면 빠진다. 활성 − 유료로 계산하는 이유다.
- REST에선 커스텀 유저 속성이 `gp:is_premium`처럼 `gp:` 접두사다. MCP와 다르다.
- 새 알림 캠페인은 `lib.mjs`의 `CAMPAIGN_LABELS`에 이름을 더한다. 안 더해도 캠페인 이름 그대로 나간다.
- 무료 체험이 결제로 넘어가기 시작하면 "결제 중" 줄이 채워진다. 그 전까지 0명은 정상이다.
