# 서드파티 서비스 상태 알림

우리가 얹혀 있는 외부 서비스가 장애로 바뀌거나 복구되면 `#의존-서비스` 채널에 카드 한 장을 보낸다.
장애가 났을 때 원인이 우리인지 남인지 바로 가리는 게 목적이다.

## 무엇을 보나

목록은 `src/status/lib.mjs`의 `TARGETS`가 전부다. 여기에 옮겨 적지 않는다 — 두 곳이 어긋나기 때문이다.
대상마다 종류가 둘 중 하나고, 추가는 등록부에 한 줄이다.

| 종류         | 무엇을 읽나                         | 왜 이 방식인가                                                      |
| ------------ | ----------------------------------- | ------------------------------------------------------------------- |
| `statuspage` | `/api/v2/status.json`의 `indicator` | Atlassian Statuspage를 쓰는 곳은 응답 모양이 똑같다                 |
| `ping`       | 서비스 주소의 응답 코드가 200인지   | 상태 페이지가 없거나(카카오) JSON을 주지 않는 곳(OpenRouter)이 있다 |

디스코드는 감시하지 않는다. 디스코드가 죽으면 알림 자체가 못 온다.
애플·구글 시스템 상태는 Statuspage 규격이 아니라 빼 두었다. 필요해지면 카카오처럼 인증 주소 핑으로 붙인다.

## 언제 보내나

상태를 `ok` · `minor` · `major` · `unknown` 네 단계로 눕히고, **레벨이 바뀔 때만** 보낸다.
`critical`은 `major`와 같이 취급한다.

```text
15분마다 전 대상 조회
→ 이전 레벨과 다른가?
  ├─ 예 → 카드 발송 (정상 복구는 초록, 일부 장애는 노랑, 장애는 빨강)
  └─ 아니오 → 조용
```

카드에는 상태 페이지가 준 설명과 함께, 우리가 실제로 어떤 주소를 찔러 어떤 응답을 받았는지가 같이 실린다.
제목을 누르면 그 서비스의 상태 페이지로 간다. 아이콘은 토스페이스 앱 이모지를 쓴다([scripts/upload-app-emoji.mjs](../scripts/upload-app-emoji.mjs)).

- `unknown`(우리가 못 읽음)은 변화로 치지 않고 이전 레벨을 그대로 둔다. 러너나 네트워크 문제를 남의 장애로 알리지 않기 위해서다.
- 핑 대상은 한 번 실패하면 재시도하고, 두 번째도 실패해야 장애로 본다.
- 첫 실행은 기준점만 저장하고 아무것도 보내지 않는다. 지금 이미 장애 중인 서비스를 새 장애로 알리지 않기 위해서다.
- 등록부에 새로 추가한 대상은 정상을 기준으로 삼는다. 추가 시점에 장애 중이면 한 번 알림이 온다.

## 구조

- `src/status/lib.mjs` — 감시 대상 등록부와 순수 로직(지표 분류·변화 감지·카드 생성). 테스트가 붙는 곳이다
- `src/status/source.mjs` — 수집기. 상태 페이지 API를 읽거나 주소를 직접 찔러 본다
- `src/status/run.mjs` — 실행부. 상태 파일 비교·발송·저장
- `.github/workflows/status-alerts.yml` — 15분 크론. 스토어 알림과 같은 방식으로 `.state/status-alerts.json`을 Actions 캐시에 넣고 뺀다

스토어 알림(`src/store/`)도 `lib.mjs`(순수)와 `asc.mjs`·`play.mjs`(수집)로 같은 배치다.

상태 파일은 `{ "initialized": true, "levels": { "vercel": "ok", ... } }` 한 덩어리다.

## 세팅 과정

1. **디스코드 웹훅** — `#의존-서비스` 채널 편집 > 연동 > 웹후크 > 새 웹후크. 이름 `landit-alerts`. URL 복사.
2. **GitHub Secrets** — 레포 Settings > Secrets and variables > Actions에 `DISCORD_WEBHOOK_DEPS`로 등록.
3. **첫 실행** — Actions > status-alerts > Run workflow. 기준점만 저장되고 채널은 조용한 게 정상이다.
4. **확인** — 두 번째 실행부터 변화가 있을 때만 카드가 온다. 로그 마지막 줄에 전송 건수가 찍힌다.

## 운영 주의

- **조용한 게 정상이다.** 알림이 없다고 잘 도는지 알 수 없으므로, 의심되면 Actions 로그에서 `상태를 못 읽음:` 줄을 본다. 특정 대상이 계속 거기 찍히면 그 서비스의 상태 주소가 바뀐 것이다.
- 로컬에서 대상만 확인하려면 웹훅 없이 수집기만 돌린다.

```bash
node -e "Promise.all([import('./src/status/lib.mjs'), import('./src/status/source.mjs')]).then(
  async ([lib, source]) => {
    for (const r of await Promise.all(lib.TARGETS.map(source.fetchTargetStatus)))
      console.log(r.key, r.level, r.response, r.checkUrl);
  },
)"
```
