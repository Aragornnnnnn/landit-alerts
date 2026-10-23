-- 빈 임시 PostgreSQL DB에서 네트워크·Vault 대역으로 레퍼럴 트리거의 계약과 롤백을 검증한다.
\set ON_ERROR_STOP on
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('landit_referral_webhook_secret', 'test-only');
CREATE SCHEMA net;
CREATE TABLE net.test_requests (url text, body jsonb, headers jsonb, timeout_ms integer);
CREATE FUNCTION net.http_post(
  url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
  headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 2000
) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('landit_test.enqueue_fail', true) = 'on' THEN
    RAISE EXCEPTION 'simulated queue failure';
  END IF;
  INSERT INTO net.test_requests VALUES (url, body, headers, timeout_milliseconds);
  RETURN 1;
END;
$$;
CREATE TABLE public.referral (
  id bigint PRIMARY KEY, inviter_id bigint NOT NULL, invitee_id bigint UNIQUE NOT NULL,
  registered_at timestamptz NOT NULL
);
CREATE TABLE public.user_profile (id bigint PRIMARY KEY, nickname varchar(100), email text);
INSERT INTO public.user_profile VALUES
  (100, '민수', 'private@example.com'), (200, '지은', 'private2@example.com');

\ir ../supabase/referral-webhook.sql
-- 재적용해도 같은 이름의 트리거가 늘어나지 않는지 확인한다.
\ir ../supabase/referral-webhook.sql

INSERT INTO public.referral VALUES (1, 100, 200, '2026-10-23T09:30:00+09:00');
INSERT INTO public.referral VALUES (1, 100, 200, '2026-10-23T09:30:00+09:00')
ON CONFLICT DO NOTHING;
UPDATE public.referral SET inviter_id = 101 WHERE id = 1;
-- 알림은 등록 시점 스냅샷이므로 이후 닉네임 수정으로 큐 내용이 바뀌지 않는다.
UPDATE public.user_profile SET nickname = '변경된 닉네임' WHERE id = 100;
DO $$
DECLARE r record;
BEGIN
  IF (SELECT count(*) FROM net.test_requests) <> 1 THEN
    RAISE EXCEPTION 'INSERT must enqueue once; UPDATE/conflict must not enqueue';
  END IF;
  SELECT * INTO STRICT r FROM net.test_requests;
  IF r.url <> 'https://landit-alerts.vercel.app/api/referral'
     OR r.headers->>'x-referral-secret' <> 'test-only'
     OR r.timeout_ms <> 10000
     OR r.body->>'type' <> 'INSERT'
     OR r.body->>'schema' <> 'public'
     OR r.body->>'table' <> 'referral'
     OR r.body->'record'->>'inviter_id' <> '100'
     OR r.body->'record'->>'invitee_id' <> '200'
     OR r.body->'record'->>'inviter_nickname' IS DISTINCT FROM '민수'
     OR r.body->'record'->>'invitee_nickname' IS DISTINCT FROM '지은'
     OR (SELECT count(*) FROM jsonb_object_keys(r.body->'record')) <> 6
     OR jsonb_typeof(r.body->'record'->'id') <> 'string'
     OR (r.body->'record'->>'registered_at')::timestamptz
        <> '2026-10-23T00:30:00Z'::timestamptz THEN
    RAISE EXCEPTION 'unexpected webhook request';
  END IF;
END;
$$;

BEGIN;
INSERT INTO public.referral VALUES (2, 100, 201, now());
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM net.test_requests WHERE body->'record'->>'id' = '2'
      AND body->'record'->>'inviter_nickname' = '변경된 닉네임'
      AND body->'record'->'invitee_nickname' = 'null'::jsonb
  ) THEN
    RAISE EXCEPTION 'missing profile must preserve ID notification';
  END IF;
END;
$$;
ROLLBACK;
DO $$
BEGIN
  IF (SELECT count(*) FROM net.test_requests) <> 1 THEN
    RAISE EXCEPTION 'rolled-back INSERT must not leave a request';
  END IF;
END;
$$;

BEGIN;
ALTER TABLE public.user_profile RENAME COLUMN nickname TO unavailable_nickname;
INSERT INTO public.referral VALUES (5, 100, 204, now());
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM net.test_requests WHERE body->'record'->>'id' = '5'
      AND body->'record'->'inviter_nickname' = 'null'::jsonb
      AND body->'record'->'invitee_nickname' = 'null'::jsonb
  ) THEN
    RAISE EXCEPTION 'nickname query failure must preserve ID notification';
  END IF;
END;
$$;
ROLLBACK;

SET landit_test.enqueue_fail = 'on';
INSERT INTO public.referral VALUES (3, 100, 202, now());
SET landit_test.enqueue_fail = 'off';
DELETE FROM vault.decrypted_secrets;
INSERT INTO public.referral VALUES (4, 100, 203, now());
DO $$
BEGIN
  IF (SELECT count(*) FROM public.referral) <> 3
     OR (SELECT count(*) FROM net.test_requests) <> 1 THEN
    RAISE EXCEPTION 'queue failure or missing secret must not prevent referral registration';
  END IF;
END;
$$;
