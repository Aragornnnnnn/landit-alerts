# 서드파티 서비스 상태 알림

우리가 얹혀 있는 외부 서비스가 장애로 바뀌거나 복구되면 `#의존-서비스` 채널에 카드 한 장을 보낸다.
장애가 났을 때 원인이 우리인지 남인지 바로 가리는 게 목적이다.

## 무엇을 보나

| 종류         | 대상                                                                           | 읽는 값                             |
| ------------ | ------------------------------------------------------------------------------ | ----------------------------------- |
| `statuspage` | Vercel · Supabase · RevenueCat · Sentry · Amplitude · Deepgram · Expo · GitHub | `/api/v2/status.json`의 `indicator` |
| `ping`       | OpenRouter · 카카오 로그인                                                     | 서비스 주소의 응답 코드가 200인지   |

여덟 곳은 Atlassian Statuspage를 써서 응답 모양이 똑같다. 그래서 대상 추가가 `src/status.mjs`의 `TARGETS`에 한 줄이다.
OpenRouter는 상태 페이지가 정적 SPA라 JSON을 안 주고, 카카오는 상태 페이지 자체가 없다. 두 곳만 주소를 직접 찔러 본다.

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

- `unknown`(우리가 못 읽음)은 변화로 치지 않고 이전 레벨을 그대로 둔다. 러너나 네트워크 문제를 남의 장애로 알리지 않기 위해서다.
- 핑 대상은 한 번 실패하면 재시도하고, 두 번째도 실패해야 장애로 본다.
- 첫 실행은 기준점만 저장하고 아무것도 보내지 않는다. 지금 이미 장애 중인 서비스를 새 장애로 알리지 않기 위해서다.
- 등록부에 새로 추가한 대상은 정상을 기준으로 삼는다. 추가 시점에 장애 중이면 한 번 알림이 온다.

## 구조

- `src/status.mjs` — 대상 등록부와 순수 로직(지표 분류·변화 감지·embed 생성), 수집기
- `src/status-run.mjs` — 실행부. 상태 파일 비교·발송·저장
- `.github/workflows/status-alerts.yml` — 15분 크론. 스토어 알림과 같은 방식으로 `.state/status-alerts.json`을 Actions 캐시에 넣고 뺀다

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
node -e "import('./src/status.mjs').then(async m => {
  for (const r of await Promise.all(m.TARGETS.map(m.fetchTargetStatus)))
    console.log(r.key, r.level, r.description);
})"
```
