# 친구 초대 등록 알림

신규 회원이 온보딩에서 초대 코드를 등록해 `public.referral` 관계가 생성되면 디스코드 채널에 카드 한 장을 보낸다. 일반 가입, 코드 입력 건너뛰기, 결제, 보상 재처리는 대상이 아니다. 등록 알림이므로 보상 지급 완료를 의미하지 않는다.

## 구조와 소유 경계

```text
Supabase Postgres public.referral INSERT
  → pg_net HTTP 큐 (DB 커밋 후 전송)
  → POST https://landit-alerts.vercel.app/api/referral
  → x-referral-secret 검증
  → 디스코드 Webhook (wait=true)
```

편지함·설문과 같은 Vercel 수신 함수를 사용한다. 별도 Supabase Edge Function은 배포하지 않는다. BE의 등록·보상 로직과 Flyway 파일은 변경하지 않는다.

- `supabase/referral-webhook.sql`: Vault에서 인증 비밀값을 읽고 최소 필드만 발행하는 DB 트리거와 PostgreSQL 함수.
- `api/referral.mjs`: 수신 인증·검증·전송. `src/referral/lib.mjs`: 이벤트 해석·카드 생성.
- 카드는 초대인·신규 회원의 닉네임과 ID, 레퍼럴 ID, 등록 시각을 표시한다. 트리거가 `public.user_profile(id, nickname)`에서 등록 시점 닉네임을 읽는다. 이후 변경된 닉네임은 기존 카드에 반영하지 않으며, 닉네임이 중복돼도 ID로 구분한다. 이메일·초대 코드·원문 데이터는 보내지 않는다. 등록 시각은 BE의 `TIMESTAMP WITH TIME ZONE`을 유지한다.
- 닉네임 조회 실패·프로필 누락·구버전 payload는 `닉네임 미확인 · user 100`처럼 ID를 유지한다. 닉네임은 100자까지 표시하고 제어 문자·멘션·마크다운을 무력화한다. 닉네임은 운영 식별 보조 정보이며 동일 인물 여부를 증명하지 않는다.

카드 예시(가상 사용자):

> 🎉 친구 초대 등록
>
> 신규 회원이 온보딩에서 초대 코드를 등록했습니다.
>
> 초대인: 민수 · user 100
>
> 신규 회원: 지은 · user 200
>
> referral 12 · 보상 지급 여부와 별개인 등록 알림

계약은 [BE PR #310](https://github.com/Aragornnnnnn/landit-be/pull/310)의 `ReferralRegistrationService`와 `V158__add_referral_rewards.sql`을 확인했다. 현재 확인한 PR head는 `accde2eb1364225d85994e596503bbaf21a4583e`다. 운영 배포 여부는 별도로 확인해야 한다.

## 설정 순서

운영 프로젝트에만 연결한다. 개발 프로젝트는 별도 테스트 채널을 사용한다.

1. 디스코드에서 수신 채널을 만들고 **채널 편집 → 연동 → 웹후크 → 새 웹후크**에서 URL을 복사한다. 소리·모바일 푸시는 수신자의 Discord 알림 설정에 따른다.
2. Vercel의 기존 `landit-alerts` 프로젝트에 아래 환경변수를 Production으로 등록한다. 인증 비밀값은 무작위로 생성한다. Webhook URL과 비밀값은 저장소·PR·터미널 출력에 남기지 않는다.

   | 이름 | 내용 |
   | --- | --- |
   | `DISCORD_WEBHOOK_REFERRAL` | 수신 채널의 Discord Webhook URL. |
   | `REFERRAL_WEBHOOK_SECRET` | Supabase에서 보낼 `x-referral-secret`과 같은 비밀값. |

3. 기존 팀 Vercel 프로젝트에 연결한 체크아웃에서 `npx vercel deploy --prod`로 수신 함수를 배포한다. GitHub 푸시만으로 반영된다고 가정하지 않는다. 기존 절차는 [reply.md](reply.md)를 따른다.
4. 운영 Supabase에서 `public.referral` 테이블과 레퍼럴 코드 입력 기능의 배포를 확인한다. BE 혼합 버전 운영 중 활성화하지 않는다.
5. Supabase에서 `pg_net`과 Vault가 활성화됐는지 확인한다. Vault에 **`landit_referral_webhook_secret`** 이름으로 2번의 인증 비밀값을 저장한다. Discord URL은 Vercel에만 둔다.
6. SQL Editor에서 `postgres` 관리자로 [`supabase/referral-webhook.sql`](../supabase/referral-webhook.sql)을 실행한다. 이 SQL은 동일 이름 트리거를 교체하므로 재실행해도 하나만 유지한다. **Dashboard에서 같은 테이블에 별도 Database Webhook을 추가하지 않는다.** 중복 알림이 된다.

이 트리거는 Supabase Database Webhook과 같은 `pg_net`을 사용한다. 비밀값을 트리거 인자에 저장하지 않고 Vault에서 읽기 위해 함수를 소스로 관리한다. HTTP 요청은 트랜잭션 커밋 이후 시작한다. [Supabase Webhook 문서](https://supabase.com/docs/guides/database/webhooks), [pg_net 문서](https://supabase.com/docs/guides/database/extensions/pg_net).

기존 ID 전용 알림에서 업데이트할 때는 Vercel 수신 함수를 먼저 배포한 다음 `supabase/referral-webhook.sql`을 재적용한다. 새 수신 함수는 기존 payload도 처리하고, 기존 수신 함수는 추가 닉네임 필드를 무시하므로 혼합 버전에서도 ID 알림을 유지한다. 프로필 조회는 기본키 두 건의 읽기뿐이며 기존 업무 테이블·보상·Flyway를 변경하지 않는다. 닉네임이 HTTP 큐와 Discord 카드에 남으므로 채널은 운영 담당자에게만 공개한다.

## 검증과 실패 대응

- 단위·수신 함수 테스트: `node --test 'src/**/*.test.mjs'`. 외부 발송은 mock으로 대체한다.
- 트리거 회귀: **빈 임시 PostgreSQL DB에서만** `psql -v ON_ERROR_STOP=1 -f scripts/test-referral-trigger.sql`. `net`·`vault` 대역을 만들기 때문에 운영 DB에서 실행하지 않는다. INSERT/UPDATE/중복 INSERT/롤백, 비밀값 누락·큐 기록 실패를 확인하며 실제 `pg_net` 네트워크 전송을 대신 검증하지는 않는다.
- 배포 뒤에는 먼저 조회로 트리거가 한 개 설치됐는지 확인하고, Vercel 로그와 Supabase `net._http_response`의 HTTP 상태를 확인한다. 200은 Discord의 메시지 저장 응답까지 받은 경우다. 401은 인증 비밀값 불일치, 400은 레퍼럴 payload 오류, 503은 Discord URL 누락, 502는 Discord 전송 실패다.
- 실제 팀 채널에 가짜 가입·테스트 메시지를 보내지 않는다. 실제 신규 등록으로 확인하거나, 테스트 채널과 개발 DB를 따로 연결해 확인한다.
- 설치 이전 관계는 소급 전송하지 않는다. 새 INSERT만 대상이므로 같은 가입 API 재요청이나 보상 재처리는 추가 발행하지 않는다. HTTP 요청 자체를 재전송하면 중복 메시지가 생길 수 있다. 영구 중복 방지·자동 재시도·전달 보장은 구현하지 않았다.
- 큐 기록 오류나 Vault 비밀값 누락은 비밀값 없는 WARNING을 남기고 등록을 계속 처리한다. 이후 HTTP 실패도 등록을 롤백하지 않는다. 실패를 자동 재전송한다고 가정하지 않는다. 응답 이력은 장기 원장이 아니므로 장애 시 먼저 실패 범위와 해당 레퍼럴 ID를 확인한다.

## 중지·비밀값 교체

알림만 중지할 때는 다음 SQL을 운영 관리자 권한으로 실행한다. 업무 테이블·레퍼럴 데이터와 보상은 유지한다.

```sql
DROP TRIGGER IF EXISTS landit_referral_insert_alert ON public.referral;
DROP FUNCTION IF EXISTS public.notify_landit_referral();
```

인증 비밀값을 교체할 때는 먼저 트리거를 제거하고 Vercel 환경변수 갱신·재배포와 Vault 값 갱신을 마친 다음 설치 SQL을 다시 실행한다. 중지 기간의 관계는 자동 소급되지 않는다. Discord 채널 URL만 바꿀 때는 Vercel 환경변수 변경 후 재배포한다.
