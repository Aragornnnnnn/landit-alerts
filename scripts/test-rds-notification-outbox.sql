-- 빈 PostgreSQL에서 RDS 알림의 트랜잭션, 요청 계약, 큐 권한과 전송 결과를 검증한다.
\set ON_ERROR_STOP on
CREATE TABLE public.user_profile (id bigint PRIMARY KEY, nickname text);
CREATE TABLE public.mailbox_feedback (id bigint PRIMARY KEY, user_profile_id bigint, feedback_type text,
  content_text text, created_at timestamp, private_internal_value text);
CREATE TABLE public.referral (id bigint PRIMARY KEY, inviter_id bigint, invitee_id bigint, registered_at timestamptz);
CREATE TABLE public.referral_billing_inbox (id bigint PRIMARY KEY, purchased_at timestamptz);
CREATE TABLE public.referral_purchase_claim (referral_id bigint PRIMARY KEY, billing_id bigint, environment text);
CREATE TABLE public.referral_reward_grant (referral_id bigint, stage text, status text);
\ir ../rds/notification-outbox.sql
\ir ../rds/notification-outbox.sql

BEGIN;
INSERT INTO public.mailbox_feedback VALUES (1,10,'BUG','rolled back', now(), 'private');
ROLLBACK;

INSERT INTO public.mailbox_feedback VALUES (2,10,'BUG','feedback', now(), 'private');
INSERT INTO public.user_profile VALUES (10, 'inviter'), (11, 'invitee');
INSERT INTO public.referral VALUES (3,10,11,now()),(4,10,12,now()),(5,10,13,now());

DO $$
BEGIN
  IF (SELECT count(*) FROM landit_alerts.rds_webhook_outbox) <> 4
    OR NOT EXISTS (SELECT FROM landit_alerts.rds_webhook_outbox
      WHERE channel='feedback' AND payload->'record'->>'id'='2'
        AND NOT (payload->'record' ? 'private_internal_value'))
    OR NOT EXISTS (SELECT FROM landit_alerts.rds_webhook_outbox
      WHERE channel='referral' AND payload->'record'->>'invitee_nickname'='invitee') THEN
    RAISE EXCEPTION 'only committed notifications with expected fields must be kept';
  END IF;
  IF landit_alerts.scan_referral_risk() <> 1
    OR landit_alerts.scan_referral_risk() <> 0 THEN
    RAISE EXCEPTION 'risk scan must enqueue exactly once within a cooldown';
  END IF;
  IF has_table_privilege('landit_alerts_dispatcher', 'public.user_profile', 'SELECT')
    OR has_table_privilege('landit_alerts_dispatcher', 'landit_alerts.rds_webhook_outbox', 'UPDATE') THEN
    RAISE EXCEPTION 'dispatcher must not have direct table access';
  END IF;
END;
$$;

SET ROLE landit_alerts_dispatcher;
DO $$
DECLARE
  job record;
  claimed integer := 0;
BEGIN
  LOOP
    SELECT * INTO job FROM landit_alerts.claim_webhook();
    EXIT WHEN NOT FOUND;
    PERFORM landit_alerts.finish_webhook(job.id,200,true);
    claimed := claimed + 1;
  END LOOP;
  IF claimed <> 5 THEN RAISE EXCEPTION 'wrong claim count %', claimed; END IF;
  PERFORM landit_alerts.scan_referral_risk();
END;
$$;
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT FROM landit_alerts.rds_webhook_outbox WHERE payload IS NOT NULL)
    OR NOT EXISTS (SELECT FROM landit_alerts.referral_risk_event WHERE delivery_status='delivered') THEN
    RAISE EXCEPTION 'completed payloads must be cleared and risk delivery confirmed';
  END IF;
END;
$$;
