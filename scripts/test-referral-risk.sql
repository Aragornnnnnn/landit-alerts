-- 빈 임시 PostgreSQL에서 초대 급증·환불 집계와 발송 억제·실패 처리를 검증한다.
\set ON_ERROR_STOP on
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY,decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('landit_referral_webhook_secret','test-only');
CREATE SCHEMA net;
CREATE TABLE net.test_requests (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,body jsonb);
CREATE TABLE net._http_response (id bigint PRIMARY KEY,status_code integer,content text);
CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}',params jsonb DEFAULT '{}',
  headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 2000)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE request_id bigint;
BEGIN
  IF current_setting('landit_test.enqueue_fail',true)='on' THEN RAISE EXCEPTION 'mock failure'; END IF;
  IF url <> 'https://landit-alerts.vercel.app/api/referral'
    OR headers->>'x-referral-secret' <> 'test-only' THEN RAISE EXCEPTION 'invalid request'; END IF;
  INSERT INTO net.test_requests(body) VALUES(body) RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;
CREATE TABLE public.user_profile (id bigint PRIMARY KEY,nickname varchar(100));
CREATE TABLE public.referral (id bigint PRIMARY KEY,inviter_id bigint,invitee_id bigint,registered_at timestamptz);
CREATE TABLE public.referral_billing_inbox (id bigint PRIMARY KEY,purchased_at timestamptz);
CREATE TABLE public.referral_purchase_claim (referral_id bigint PRIMARY KEY,billing_id bigint,environment text);
CREATE TABLE public.referral_reward_grant (referral_id bigint,stage text,status text,recipient_role text);
CREATE TEMP TABLE test_clock AS SELECT now() AS at;
\ir ../supabase/referral-risk.sql
UPDATE landit_alerts.referral_risk_rule SET min_count=4 WHERE code='INVITE_BURST';
\ir ../supabase/referral-risk.sql
DO $$
BEGIN
  IF (SELECT min_count FROM landit_alerts.referral_risk_rule WHERE code='INVITE_BURST') <> 4 THEN
    RAISE EXCEPTION 'reinstall must preserve operator settings';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace n,LATERAL aclexplode(n.nspacl) a
    WHERE n.nspname='landit_alerts' AND a.grantee=0) THEN
    RAISE EXCEPTION 'private schema must not grant PUBLIC';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname='landit_alerts' AND a.grantee=0) THEN
    RAISE EXCEPTION 'functions must not grant PUBLIC execution';
  END IF;
END;
$$;
UPDATE landit_alerts.referral_risk_rule SET min_count=3 WHERE code='INVITE_BURST';
INSERT INTO public.user_profile VALUES (100,'민수'),(110,'지은'),(500,'환불 검토 예시');
INSERT INTO public.referral SELECT n,100,1000+n,at-interval '1 minute' FROM generate_series(1,3) n,test_clock;
INSERT INTO public.referral SELECT 10,100,1010,at-interval '10 minutes' FROM test_clock;
INSERT INTO public.referral SELECT 20+n,110,2000+n,at-interval '12 hours' FROM generate_series(1,10) n,test_clock;
INSERT INTO public.referral SELECT 40+n,120,3000+n,at-interval '1 minute' FROM generate_series(1,2) n,test_clock;
INSERT INTO public.referral SELECT 500+n,500,4000+n,at-interval '2 days' FROM generate_series(1,8) n,test_clock;
INSERT INTO public.referral_billing_inbox SELECT 500+n,
  at + CASE WHEN n=7 THEN interval '-8 days' WHEN n=8 THEN interval '1 day' ELSE interval '-1 day' END
  FROM generate_series(1,8) n,test_clock;
INSERT INTO public.referral_purchase_claim SELECT 500+n,500+n,'PRODUCTION' FROM generate_series(1,8) n;
INSERT INTO public.referral_reward_grant SELECT 500+n,'PURCHASE',
  CASE WHEN n<=3 OR n>=7 THEN 'REVERSED' ELSE 'CREDITED' END,'INVITER' FROM generate_series(1,8) n;
INSERT INTO public.referral_reward_grant VALUES (501,'PURCHASE','REVERSED','INVITEE'),(504,'SIGNUP','REVERSED','INVITER');
DO $$
DECLARE t timestamptz; r record;
BEGIN
 SELECT at INTO t FROM test_clock;
 IF (SELECT count(*) FROM landit_alerts.evaluate_referral_risk(t))<>3 THEN RAISE EXCEPTION 'three expected candidates'; END IF;
 SELECT * INTO STRICT r FROM landit_alerts.evaluate_referral_risk(t) WHERE rule_code='INVITE_BURST';
 IF r.observed_count<>3 OR cardinality(r.evidence_referral_ids)<>3 THEN RAISE EXCEPTION 'window lower boundary excluded'; END IF;
 SELECT * INTO STRICT r FROM landit_alerts.evaluate_referral_risk(t) WHERE rule_code='REFUND_RATIO';
 IF r.observed_count<>6 OR r.matched_count<>3 OR cardinality(r.evidence_referral_ids)<>3 THEN
   RAISE EXCEPTION 'refund cohort must count first purchases once, ignore old/future and signup refunds'; END IF;
END;
$$;
BEGIN;
UPDATE landit_alerts.referral_risk_rule SET enabled=false;
DO $$ BEGIN
 IF landit_alerts.scan_referral_risk()<>0 THEN RAISE EXCEPTION 'disabled rules must not send'; END IF;
END; $$;
ROLLBACK;
BEGIN;
UPDATE public.referral_reward_grant SET status='CREDITED' WHERE referral_id=503;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM landit_alerts.evaluate_referral_risk() WHERE rule_code='REFUND_RATIO') THEN
   RAISE EXCEPTION 'restored refund must fall below threshold'; END IF;
END; $$;
ROLLBACK;
DO $$ BEGIN
 IF landit_alerts.scan_referral_risk()<>3 OR landit_alerts.scan_referral_risk()<>0 THEN
   RAISE EXCEPTION 'first scan sends once, repeat is suppressed'; END IF;
 IF (SELECT count(*) FROM net.test_requests)<>3 THEN RAISE EXCEPTION 'duplicate request'; END IF;
 IF NOT EXISTS (SELECT 1 FROM net.test_requests WHERE body->'record'->>'inviter_nickname'='민수'
   AND body->>'type'='REFERRAL_RISK') THEN RAISE EXCEPTION 'nickname payload missing'; END IF;
END; $$;
INSERT INTO net._http_response SELECT request_id,
 CASE WHEN rule_code='INVITE_DAILY' THEN 502 ELSE 200 END,
 CASE WHEN rule_code='INVITE_BURST' THEN '{"sent":true}' WHEN rule_code='INVITE_DAILY' THEN '<html>error</html>' ELSE '{"skipped":true}' END
 FROM landit_alerts.referral_risk_event;
SELECT landit_alerts.scan_referral_risk();
DO $$ BEGIN
 IF (SELECT count(*) FROM landit_alerts.referral_risk_event WHERE delivery_status='delivered')<>1
  OR (SELECT count(*) FROM landit_alerts.referral_risk_event WHERE delivery_status='failed')<>2 THEN
  RAISE EXCEPTION 'delivery must require HTTP 200 sent=true; HTML errors must not break scan'; END IF;
END; $$;
DELETE FROM net._http_response;
UPDATE landit_alerts.referral_risk_event SET delivery_status='queued',queued_at=now()-interval '16 minutes'
 WHERE rule_code='INVITE_BURST';
SELECT landit_alerts.scan_referral_risk();
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM landit_alerts.referral_risk_event WHERE delivery_status='unknown') THEN
   RAISE EXCEPTION 'expired response must be unknown'; END IF;
END; $$;
UPDATE landit_alerts.referral_risk_event SET detected_at=now()-interval '61 minutes' WHERE rule_code='INVITE_BURST';
DO $$ BEGIN
 IF landit_alerts.scan_referral_risk()<>1 THEN RAISE EXCEPTION 'cooldown expiry allows reminder'; END IF;
END; $$;
BEGIN;
DELETE FROM landit_alerts.referral_risk_event;
SET LOCAL landit_test.enqueue_fail='on';
DO $$ BEGIN
 BEGIN
  PERFORM landit_alerts.scan_referral_risk();
  RAISE EXCEPTION 'expected enqueue error' USING ERRCODE='P0002';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM landit_alerts.referral_risk_event) THEN RAISE EXCEPTION 'failed queue must not reserve cooldown'; END IF;
END; $$;
ROLLBACK;
BEGIN;
DELETE FROM landit_alerts.referral_risk_event;
DELETE FROM vault.decrypted_secrets;
DO $$ BEGIN
 BEGIN
  PERFORM landit_alerts.scan_referral_risk();
  RAISE EXCEPTION 'expected missing secret error' USING ERRCODE='P0002';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
 END;
 IF EXISTS(SELECT 1 FROM landit_alerts.referral_risk_event) THEN RAISE EXCEPTION 'missing secret must not reserve cooldown'; END IF;
END; $$;
ROLLBACK;

-- 한 번에 4명 이상 탐지되면 발송 제한 밖의 후보도 보존한다.
BEGIN;
DELETE FROM landit_alerts.referral_risk_event;
DELETE FROM net.test_requests;
TRUNCATE public.referral;
INSERT INTO public.referral SELECT 10000+n,600+(n-1)/3,20000+n,now()-interval '9 minutes 30 seconds'
FROM generate_series(1,12) n;
DO $$ BEGIN
 IF landit_alerts.scan_referral_risk()<>3 THEN RAISE EXCEPTION 'queue cap must be three'; END IF;
 IF (SELECT count(*) FROM landit_alerts.referral_risk_event)<>4
   OR (SELECT count(*) FROM landit_alerts.referral_risk_event WHERE delivery_status='pending')<>1 THEN
   RAISE EXCEPTION 'all four detections must persist'; END IF;
END; $$;
-- 다음 검사 시점에 조건 밖으로 빠진 상황을 재현한다.
UPDATE public.referral SET registered_at=now()-interval '11 minutes';
DO $$ BEGIN
 IF landit_alerts.scan_referral_risk()<>1 THEN RAISE EXCEPTION 'pending detection must send after window expires'; END IF;
 IF EXISTS(SELECT 1 FROM landit_alerts.referral_risk_event WHERE delivery_status='pending') THEN
   RAISE EXCEPTION 'pending backlog must drain'; END IF;
END; $$;
ROLLBACK;
