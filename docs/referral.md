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


## 이상 징후 알림

`supabase/referral-risk.sql`은 별도 `landit_alerts` 스키마에 설정·이력과 검사 함수를 만든다. `supabase/referral-risk-cron.sql`은 Supabase pg_cron으로 매분 검사한다. 기존 `/api/referral` 인증과 Discord 채널을 사용하며 등록 카드와 별개의 경고 카드를 보낸다. 자동 차단·보상 보류·지급 변경은 하지 않는다.

| 규칙 | 기본 기준 | 같은 초대인·같은 규칙 재알림 간격 |
| --- | --- | --- |
| `INVITE_BURST` | 최근 10분 등록 3명 이상. | 60분. |
| `INVITE_DAILY` | 최근 24시간 등록 10명 이상. | 24시간. |
| `REFUND_RATIO` | 최근 7일 확정 첫 결제 5건 이상 중 현재 환불 50% 이상. | 24시간. |

시간 창은 `(검사 시각 - 기간, 검사 시각]`이다. 환불 규칙의 분모는 `referral_purchase_claim`의 확정된 운영 첫 결제이고 `billing_id`의 `purchased_at`을 기준으로 한다. 분자는 해당 관계의 PURCHASE 보상에 현재 `REVERSED`가 있는 첫 결제다. 양쪽 보상·반복 웹훅·가입 보상 환수는 중복 계산하지 않고, 환불 취소로 복구된 건은 제외한다. 일반 구독 전체의 환불률이나 아직 정산되지 않은 환불을 측정하지 않는다.

카드는 탐지 규칙, 초대인 닉네임·ID, 집계 기간, 관측 건수·기준, 최근 관련 레퍼럴 ID 최대 10건을 보여 준다. 닉네임은 검사 시점 값이다. 두 급증 기준을 동시에 만족하면 서로 다른 규칙으로 각각 알릴 수 있다. 기기·IP 탐지는 구현하지 않았다.

### 배포와 운영 설정

1. 새 수신 함수를 Vercel Production에 배포한다. 구버전 수신 함수는 위험 이벤트를 skipped로 응답하므로 먼저 배포해야 한다.
2. `postgres`로 `supabase/referral-risk.sql`을 적용한다. `landit_alerts`는 외부 API에 노출하지 않고 운영 DB 관리자만 접근한다. 업무 테이블은 읽기만 한다.
3. `SELECT * FROM landit_alerts.evaluate_referral_risk();`로 발송 없이 후보를 확인한다.
4. `supabase/referral-risk-cron.sql`을 적용한다. 같은 이름 작업은 갱신되므로 중복 등록하지 않는다. 검사 제한 시간은 20초다.

설정 변경은 Supabase SQL Editor의 `postgres` 권한으로 아래 테이블만 수정한다. 별도 어드민 UI는 없다. 설치 SQL을 재실행해도 변경한 기준은 유지한다.

```sql
SELECT * FROM landit_alerts.referral_risk_rule ORDER BY code;
-- 예: 10분 내 5명으로 기준을 바꾸고, 재알림은 2시간 간격으로 변경한다.
UPDATE landit_alerts.referral_risk_rule
SET min_count=5, window_minutes=10, cooldown_minutes=120
WHERE code='INVITE_BURST';
-- 개별 규칙 중지/재개는 enabled=false/true로 변경한다.
```

탐지 결과를 모두 `pending` 이력으로 저장하고 advisory lock으로 겹친 검사를 직렬화한다. 대기 이력은 오래된 순서로 최대 3건씩 HTTP 큐에 넣는다. 다음 검사 전에 시간 창을 벗어나도 이미 탐지한 건은 보존하며, 비활성화한 규칙의 대기 이력은 재개할 때까지 발송하지 않는다. 지속적으로 기준을 넘으면 재알림 간격 뒤 다시 보낸다. 이 간격은 탐지 시점 기준으로 실패·응답 불명 상태에도 적용한다. HTTP 자동 재시도는 없으며 운영자가 이력을 확인해야 한다. 수동 재전송은 중복 수신 가능성을 확인한 뒤 별도로 처리한다.

```sql
SELECT id,rule_code,inviter_id,detected_at,delivery_status,http_status
FROM landit_alerts.referral_risk_event ORDER BY id DESC LIMIT 50;
SELECT jobid,schedule,active FROM cron.job WHERE jobname='landit-referral-risk';
SELECT status,start_time,end_time,return_message FROM cron.job_run_details
WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='landit-referral-risk')
ORDER BY start_time DESC LIMIT 10;
```

`pending`은 발송 대기, `queued`는 HTTP 큐 등록 상태다. 다음 검사에서 HTTP 200과 `sent=true`를 확인해야 `delivered`로 기록한다. 이것은 Discord의 메시지 저장 응답이며 사람이 읽었다는 뜻은 아니다. 실패 응답은 `failed`, HTTP 큐 등록 후 15분 내 응답을 확인하지 못하면 `unknown`으로 남긴다. 비밀값 누락·집계·큐 오류는 cron 실패로 기록하며 업무 등록에는 관여하지 않는다. pg_net 응답의 원문과 인증값은 알림 이력에 복사하지 않는다.

전체 검사 중지 시 `SELECT cron.unschedule('landit-referral-risk');`를 실행한다. 기존 등록 알림과 업무·보상 데이터는 유지한다. 다시 시작하려면 cron 설치 SQL만 재실행한다. 설정·이력은 보존하며 자동 삭제하지 않는다.

검증은 빈 임시 DB에서 `psql -v ON_ERROR_STOP=1 -f scripts/test-referral-risk.sql`을 실행한다. 운영 DB에서는 테스트 스크립트를 실행하지 않는다. 기준 경계·복원된 환불·중복 계산·재적용·규칙 비활성화·재알림·HTTP 실패·큐 실패·비밀값 누락을 대역으로 검증한다.
