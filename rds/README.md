# RDS 편지함·추천인 알림

RDS의 INSERT 트리거가 편지함 피드백과 추천인 등록 이벤트를 원본 트랜잭션과 함께 기록한다. EC2의 systemd 타이머가 매분 추천인 위험을 검사하고 기록한 이벤트를 기존 Vercel 수신기로 전달한다. 추천인 위험 집계, 재알림 간격 및 성공 판정은 기존 SQL을 사용한다.

## 최초 적용

1. 작업창 전까지 기존 Supabase 트리거와 예약 작업을 유지한다. 최종 복원에 `public` 업무 데이터와 별도로 `landit_alerts.referral_risk_rule`, `landit_alerts.referral_risk_event`의 설정·이력을 포함한다. Supabase 관리 트리거, Vault, `net` 스키마는 대상에 복원하지 않는다.
2. 권한 있는 RDS 관리자로 복원한 RDS에 `psql -v ON_ERROR_STOP=1 -f rds/notification-outbox.sql`을 적용한다. 위험 알림의 기존 요청 번호가 신규 번호와 겹치지 않는지 확인하려면 운영 이력을 먼저 복원해야 한다. 기존 함수가 복원됐다면 설치본의 RDS 전송 함수를 사용한다.
3. `landit_alerts_dispatcher` 전용 LOGIN 계정을 발급한다. RDS TLS 연결용 `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=verify-full`, `PGSSLROOTCERT`를 설정한다. `FEEDBACK_WEBHOOK_SECRET`과 `REFERRAL_WEBHOOK_SECRET`은 기존 Vercel 값과 일치하도록 호스트의 root 전용 `/opt/landit/alerts.env`에 보관한다. CA 파일은 서비스가 읽을 수 있게 둔다. 앱·푸시 조회 계정에는 이 발송 권한을 주지 않는다.
4. EC2에서 Python 3과 PostgreSQL 클라이언트를 확인하고, 발송기를 `/opt/landit/alerts/dispatch-webhooks.py`, 서비스와 타이머를 `/etc/systemd/system/`에 설치한다. 기존 Supabase의 편지함·추천인 동작을 중지하고 RDS 검증을 마친 뒤 `systemctl enable --now landit-alerts.timer`로 시작한다.
5. 시험에서는 별도 수신기를 모의한다. 운영에서는 새 이벤트의 처리 상태와 Vercel 수신 로그를 맞춰 본다. 편지함의 `accepted=true`는 Vercel 접수이며 Discord 저장과 별개다. 추천인 위험은 HTTP 200과 `sent=true`를 모두 확인한다.

SQL 설치 파일을 재실행하면 위험 알림 규칙과 이력을 유지한다. 원본에서 이미 대기 중이었던 pg_net 요청은 다시 보내지 않는다. 응답을 받지 못한 전송은 자동 재발송이 중복을 만들 수 있어 결과 불명으로 남긴다. 최종 결과 확인 후 큐 본문을 지운다. 타이머 중지와 원본 재개 순서는 LAN-886 전환 절차를 따른다.

## 검증

빈 로컬 PostgreSQL에서 `psql -v ON_ERROR_STOP=1 -f scripts/test-rds-notification-outbox.sql`을 실행한다. 기존 Supabase의 `scripts/test-referral-risk.sql`과 `scripts/test-referral-trigger.sql`도 서로 다른 빈 DB에서 실행한다. 실제 운영 Vercel·Discord 발송은 이 테스트 범위에서 제외한다.
