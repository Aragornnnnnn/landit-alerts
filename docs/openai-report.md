# OpenAI 키별 비용 서버 보고

매일 **한국 시간 오전 10시**에 GitHub Actions 서버가 OpenAI Costs API를 조회해 지정 Discord 웹훅에 텍스트 한 장을 보낸다. **Mac·Codex·Safari는 필요 없다.** CSV와 다른 파일은 첨부하지 않는다. 잔액은 조회·추정하지 않고 OpenAI 결제 화면 링크를 제공한다.

## 보고 내용

- 가장 최근에 완료된 UTC 하루의 비용을 사용한다. 실제 API가 UTC 날짜 경계로 버킷을 정렬한다. 오전 10시 보고의 기간은 전날 09:00~당일 09:00 KST이며 UTC·KST를 본문에 모두 표시한다.
- 전체 합계와 API 키별 금액을 표시한다. GitHub 변수 `OPENAI_KEY_NAMES`의 ID→이름 매핑으로 `prod_ai`, `develop_ai` 같은 이름을 표시한다. 이름이 없는 새 키는 `미등록 키 (키 ID)`, 귀속이 없는 비용은 `키 미분류·공통 비용`으로 표시한다. 비밀 키 값은 사용하지 않는다.
- 키별 금액은 조회 시점 집계로, 지연 반영·조정으로 바뀔 수 있다. 조회 실패를 0달러로 바꾸지 않고 실패 이유를 Discord로 보낸다. 전체 본문이 Discord의 2,000자 한도를 넘으면 일부 항목을 조용히 버리지 않고 실행을 실패시킨다.
- 관리자 키·웹훅·금액·보고 본문은 공개 Actions 로그·artifact·캐시에 저장하지 않는다.

## 예약 실행

`vercel.json`의 `/api/openai-cron`은 매일 UTC 00시(KST 09시대)에 호출된다. 기존 `CRON_SECRET`으로 요청을 검증하고 기존 `GH_WORKFLOW_TOKEN`으로 `main`의 `openai-report.yml`을 실행한다. GitHub 러너가 KST 10시까지 기다린 뒤 전송한다. 기존 지표 알림 크론은 유지한다.

Vercel Hobby의 호출 시각은 해당 시간 안에서 달라지므로 한 시간 앞서 실행해 대기한다. Actions의 UTC 01:17 스케줄은 Vercel 실패 시 예비 경로다. 서버 대기열·플랫폼 장애가 있으면 늦을 수 있어 정각 전달은 보장하지 않는다. 모든 경로는 동일한 concurrency 그룹과 날짜별 전송 상태를 사용한다.

## 중복 방지

`.state/openai-server/delivery.json`만 캐시한다. 날짜별 캐시 키는 `openai-report-v1-YYYY-MM-DD-pending`과 `...-sent`다.

1. sent를 먼저 복원하고 없으면 같은 날짜의 pending을 복원한다. sent면 조회·전송을 건너뛰고, pending이면 이전 결과를 확인하기 전에는 중지한다.
2. 비용을 조회해 임시 본문 파일을 만들고 날짜·실행 ID·pending 상태를 기록한다.
3. pending 캐시를 저장하고 GitHub API에서 저장 여부를 확인한다. 확인 실패 시 전송하지 않는다.
4. Discord 영수증을 받은 뒤 sent와 메시지 ID를 저장한다. 금액·본문은 캐시하지 않는다.
5. 성공 캐시 저장에 실패하거나 Discord 응답이 끊기면 pending을 남긴다. Discord에서 실제 전송 여부를 확인한 후에만 캐시를 복구한다. 임의로 재실행해 중복 전송하지 않는다.

당일 보고가 없고 pending만 남았다면 운영자가 Discord 확인 후 **해당 날짜의 pending 캐시만** 지우고 workflow_dispatch로 다시 실행할 수 있다. 이미 전송됐으면 재전송하지 않고 영수증 상태를 복구한다. 캐시 수동 삭제·만료 이후 과거 실행을 재현하면 중복 방지 보장은 없다. 스케줄은 현재 완료된 UTC 날짜만 다룬다.

## 서버 설정

GitHub 저장소 `Aragornnnnnn/landit-alerts`의 Actions Secrets.

| Secret | 용도 |
| --- | --- |
| `OPENAI_ADMIN_KEY` | OpenAI 조직 비용 조회용 관리자 키 |
| `OPENAI_ORG_ID` | 대상 조직 ID |
| `DISCORD_WEBHOOK_OPENAI` | 일일 비용을 보낼 Discord 웹훅 |

Actions 변수 `OPENAI_KEY_NAMES`에는 아래 형태의 JSON을 등록한다. 예시는 실제 키 ID가 아니다.

```json
{"key_example_prod":"prod_ai","key_example_dev":"develop_ai"}
```

Vercel에는 기존 `CRON_SECRET`, `GH_WORKFLOW_TOKEN`을 사용한다. 관리자 키는 GitHub에만 저장하며 Vercel로 복제하지 않는다. 크론 추가는 프로덕션 배포 후 적용된다. GitHub 워크플로는 기본 브랜치 `main`에서만 실행한다.

## 로컬 비밀값 등록과 확인

[OpenAI Admin keys](https://platform.openai.com/settings/organization/admin-keys)에서 사용자가 보고용 키를 발급한 뒤 `python3 scripts/setup-openai.py`를 실행하면 숨김 입력·비용 API 권한 확인 후 Git에서 제외되는 권한 600 파일 `.env.openai`에 저장한다. 이 명령만으로 서버 Secrets가 변경되지는 않는다.

로컬 미리보기는 `node --env-file=.env.openai src/openai/run.mjs`다. 서버 전송은 Actions의 `openai-report` 워크플로를 실행한다. 키 이름을 바꾸면 GitHub 변수도 갱신한다.

## 검증

```sh
node --test 'src/**/*.test.mjs'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p 'test_setup_openai.py'
```

날짜·버킷·페이지, 키 이름, 파일 첨부 금지, 조회 실패, 전송 예약/영수증, 복원된 pending, 크론 인증·dispatch를 검증한다. 실제 서버 실행·Discord 메시지·첨부 개수는 배포 후 별도로 확인한다.
