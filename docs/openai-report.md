# OpenAI 매일 잔액·키별 비용 보고

매일 **10:00 Asia/Seoul**에 이 채팅의 Codex heartbeat가 Safari 결제 화면을 읽고, 로컬 실행기로 Costs API를 조회해 Discord에 한 장을 보낸다. Safari 로그인 세션을 쓰므로 Mac과 Codex가 실행 가능해야 한다. 절전·종료·로그인 만료로 늦어지거나 조회가 실패할 수 있으며 정각 전달을 보장하지 않는다. 서버의 Vercel 크론이나 GitHub Actions에는 Safari 세션을 복사하지 않는다. 기존 알림 스케줄은 바꾸지 않는다.

## 집계와 실패 처리

- 잔액은 `https://platform.openai.com/settings/organization/billing/overview`의 **API credit balance**다. 조직 이름과 General의 조직 ID를 확인하고 새로고침한다. 월 한도·자동충전 금액·누적 비용과 구분한다.
- 잔액은 15분 이내의 확인 시각, USD, 조직 ID, 출처를 검증한다. 잔액을 못 읽으면 `status: unavailable`로 명시한다. 과거 잔액을 현재 잔액으로 재사용하거나 사용액을 빼서 추정하지 않는다.
- 비용은 가장 최근에 완료된 **UTC 날짜 00:00 이상, 다음 날 00:00 미만**다. [공식 Costs API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)에 시작·끝 Unix timestamp와 `group_by[]=api_key_id`를 전달한다. 반환된 버킷이 요청 구간 전체를 덮는지 확인한다. 다른 시간 범위로 반환되면 집계 실패로 보고한다. 실제 조회에서 API가 UTC 날짜로 버킷을 정렬함을 확인했다. 오전 10시 보고는 전날 09:00부터 당일 09:00 KST까지이며 보고서에 UTC와 KST 양쪽 구간을 표시한다. 한국 시간 자정 기준 전날 사용액으로 오인하지 않는다.
- 비용은 API key **ID**별이다. 비밀 키 값은 출력하지 않는다. `null` 귀속은 미분류·공통 비용으로 별도 표시한다. 전체 항목은 CSV로 첨부하고, 본문에는 금액순으로 들어갈 만큼 표시한다. 조회 시점의 집계이며 지연 반영·조정될 수 있다.
- Admin key가 없거나 API 조회가 실패해도 잔액 보고는 보낸다. 실패를 $0으로 표시하지 않는다. 잔액만 실패하면 키별 비용을 보낸다.
- 같은 비용 날짜는 로컬 `.state/openai/YYYY-MM-DD.json`으로 중복을 막고, lock으로 동시 실행을 막는다. 수동 테스트도 같은 상태 경로를 쓰면 당일 중복을 막는다.
- Discord에 보내기 직전에 `pending`, 성공 영수증을 받으면 `sent`와 메시지 ID를 저장한다. 타임아웃·영수증 누락·프로세스 종료 등으로 `pending`이 남으면 자동 재전송하지 않는다. 채널에서 실제 메시지를 확인한 후에만 해당 파일·중단된 lock을 복구한다. 저장소 이동 시 `.state/openai`를 함께 보존한다.
- 보고 내용·키 ID·잔액·CSV는 공개 Actions 로그나 artifact에 올리지 않는다. 비밀값과 브라우저 세션도 커밋하지 않는다.

## 비밀값 등록

[OpenAI Admin keys](https://platform.openai.com/settings/organization/admin-keys)에서 대상 조직을 확인하고 보고용 키를 사용자가 직접 만든다. 일반 프로젝트 추론 키와 다르다. 발급 화면에서 권한 선택이 제공되면 조직 비용을 읽는 데 필요한 권한만 선택한다. 키는 채팅·스크린샷·커밋에 붙이지 않는다.

Mac의 터미널에서 저장소로 이동한 뒤 실행한다.

```sh
python3 scripts/setup-openai.py
```

Admin key·웹훅은 화면에 표시되지 않는 입력으로 받는다. 기존 웹훅·조직 ID는 유지한다. Admin key는 다시 입력해 교체할 수 있고 Enter를 누르면 기존 값을 사용한다. 앞뒤 공백과 감싸는 따옴표를 제거한 뒤, 접두사만으로 판정하지 않고 공식 Costs API의 읽기 요청으로 권한을 확인한다. 인증·조회 실패 시 기존 설정 파일을 바꾸지 않는다. `.env.openai`를 파일 권한 `600`으로 저장하며 Git에서 제외한다. 비밀값이 기록된 명령줄 인자나 shell history를 만들지 않는다.

| 환경변수 | 용도 |
| --- | --- |
| `OPENAI_ADMIN_KEY` | 비용 조회용 OpenAI Admin API key |
| `OPENAI_ORG_ID` | Safari에서 확인한 대상 조직 ID. 요청 헤더에도 사용 |
| `DISCORD_WEBHOOK_OPENAI` | 사용자가 지정한 보고 채널 웹훅 |
| `OPENAI_STATE_DIR` | 선택. 중복 방지 상태 폴더. 기본 `.state/openai` |

## 잔액 입력과 실행

Codex가 Safari에서 직접 확인한 값으로 `.state/openai-balance.json`을 만든다. 아래는 형식 예시이며 실제 값이나 최신 잔액으로 사용하면 안 된다.

```json
{
  "source": "https://platform.openai.com/settings/organization/billing/overview",
  "organizationId": "org-example",
  "status": "ok",
  "usd": 25.5,
  "currency": "usd",
  "observedAt": "2026-10-29T01:00:00.000Z"
}
```

조회 불가 시 `status`를 `unavailable`로 하고 `usd`는 넣지 않는다. `observedAt`은 조회를 시도한 시각이다. 조직 ID는 등록된 대상 조직을 쓰되, 화면에서 다른 조직을 보고 있다면 먼저 대상을 다시 확인한다.

```sh
# API는 조회하지만 Discord에 보내지 않는 미리보기.
node --env-file=.env.openai src/openai/run.mjs .state/openai-balance.json

# 실채널 전송. 같은 날짜의 성공 보고가 있으면 아무것도 하지 않는다.
node --env-file=.env.openai src/openai/run.mjs .state/openai-balance.json --send
```

키 등록 뒤 최초 미리보기에서 실제 Costs API 인증·권한·UTC 경계·키별 결과를 확인한다. 미리보기는 금융 정보이므로 공개 로그에 남기지 않는다. 스케줄은 이 채팅의 Codex 자동화에서 관리하며, 저장소를 clone하는 것만으로 자동화가 생기지 않는다.

## 검증

```sh
node --test 'src/**/*.test.mjs'
```

날짜 변경·윤년, API 페이지, 비용 구간 누락·중복, 미분류 비용, 오래된 잔액, 전송 실패, 중복·동시 실행, CSV 전체 항목과 멘션 차단을 테스트한다. 모의 API 테스트는 실제 계정의 조회 권한이나 실제 Discord 전달을 증명하지 않는다.
