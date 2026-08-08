# landit-alerts

랜딧 앱의 스토어 소식을 디스코드로 알리는 도구 모음. 서버 없이 GitHub Actions cron(30분)으로 돈다.

## 알림 종류

- **새 리뷰** → `#⭐-앱-리뷰` — App Store(텍스트 리뷰)·Play Store(리뷰, 기기·OS 포함). 별점 색으로 구분(4-5 초록, 3 노랑, 1-2 빨강).
- **평점 변동** → `#⭐-앱-리뷰` — 평균 평점이 바뀌면 두 스토어 현황을 한 장에 정리. 별점만 남긴 평가는 개별 조회가 불가(스토어 정책)해서 여기에만 간접 반영된다.
- **새 버전 공개** → `#🚀-앱-업데이트` — 릴리즈 노트와 해당 스토어 링크.
- **심사 통과·거절** → `#🚀-앱-업데이트` — 애플만, ASC API 키 등록 시 활성화.

## 동작 방식

`src/run.mjs`가 30분마다 스토어를 폴링해 이전 상태(Actions cache)와 비교하고, 달라진 것만 디스코드 웹훅으로 보낸다. 첫 실행은 기준점만 저장하고 알림을 보내지 않는다. 리뷰는 ID로 비교해 중복 알림이 없다.

- App Store 리뷰: 공개 RSS (키 불필요)
- App Store 버전·평점: iTunes lookup API (키 불필요)
- Play Store 버전: 스토어 페이지 파싱 (비공식 — 깨지면 알림이 안 올 뿐 오알림은 없다)
- Play Store 리뷰: Play Developer API — `PLAY_SERVICE_ACCOUNT_JSON` 등록 시 활성화
- 애플 심사 상태: App Store Connect API — `ASC_ISSUER_ID`/`ASC_KEY_ID`/`ASC_PRIVATE_KEY` 등록 시 활성화

## Secrets

| 이름                                               | 용도               | 상태              |
| -------------------------------------------------- | ------------------ | ----------------- |
| `DISCORD_WEBHOOK_REVIEW`                           | 리뷰 채널 웹훅     | 필수              |
| `DISCORD_WEBHOOK_UPDATE`                           | 업데이트 채널 웹훅 | 필수              |
| `PLAY_SERVICE_ACCOUNT_JSON`                        | Play 리뷰 조회     | 선택 (키 발급 후) |
| `ASC_ISSUER_ID` / `ASC_KEY_ID` / `ASC_PRIVATE_KEY` | 애플 심사 상태     | 선택 (키 발급 후) |

## 로컬 실행

```bash
node --test src/*.test.mjs   # 단위 테스트
DISCORD_WEBHOOK_REVIEW=... DISCORD_WEBHOOK_UPDATE=... node src/run.mjs
```

상태 파일은 기본 `.state/store-alerts.json`, `STATE_FILE` 환경변수로 바꿀 수 있다.
