-- 빈 임시 PostgreSQL에서 설문 이탈 판정과 중복 발송 방지를 검증한다.
\set ON_ERROR_STOP on
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text PRIMARY KEY,decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('landit_survey_webhook_secret','test-only');
CREATE SCHEMA net;
CREATE TABLE net.test_requests (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,body jsonb);
CREATE FUNCTION net.http_post(url text,body jsonb DEFAULT '{}',params jsonb DEFAULT '{}',
  headers jsonb DEFAULT '{}',timeout_milliseconds integer DEFAULT 2000)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE request_id bigint;
BEGIN
  IF url <> 'https://landit-alerts.vercel.app/api/survey'
    OR headers->>'x-survey-secret' <> 'test-only' THEN RAISE EXCEPTION 'invalid request'; END IF;
  INSERT INTO net.test_requests(body) VALUES(body) RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;
CREATE TABLE public.survey_responses (
  id bigint PRIMARY KEY,
  survey text NOT NULL DEFAULT 'general',
  user_id bigint,
  email text,
  answers jsonb,
  completed boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 설치 전부터 있던 미완료 응답은 기준점이 되어 알리지 않는다.
INSERT INTO public.survey_responses (id,completed,answers,created_at)
VALUES (1,false,'{"channel":"x"}',now()-interval '3 days');
\ir ../supabase/survey-abandoned.sql

INSERT INTO public.survey_responses (id,survey,user_id,email,completed,answers,created_at) VALUES
  (2,'paid',7,'a@b.com',false,'{"premium_reason":"환급"}',now()-interval '11 minutes'),
  (3,'general',8,NULL,false,'{"channel":"지인 추천"}',now()-interval '12 minutes'),
  (4,'paid',9,NULL,false,'{"premium_reason":"쓰는 중"}',now()-interval '9 minutes'),
  (5,'paid',10,NULL,true,'{"premium_reason":"제출함"}',now()-interval '30 minutes');

DO $$
DECLARE sent integer;
BEGIN
  SELECT landit_alerts.scan_survey_abandoned() INTO sent;
  IF sent <> 2 THEN RAISE EXCEPTION 'expected 2 abandoned, got %', sent; END IF;
  IF (SELECT array_agg((body->'record'->>'id')::bigint ORDER BY id) FROM net.test_requests)
    <> ARRAY[3,2]::bigint[] THEN
    RAISE EXCEPTION 'must send only rows past 10 minutes, oldest first';
  END IF;
  IF EXISTS (SELECT 1 FROM net.test_requests WHERE body->>'type' <> 'SURVEY_ABANDONED'
    OR body->>'table' <> 'survey_responses') THEN
    RAISE EXCEPTION 'unexpected payload type';
  END IF;
  IF (SELECT body->'record'->>'survey' FROM net.test_requests
    WHERE body->'record'->>'id' = '2') <> 'paid' THEN
    RAISE EXCEPTION 'survey kind must be sent for channel routing';
  END IF;

  SELECT landit_alerts.scan_survey_abandoned() INTO sent;
  IF sent <> 0 THEN RAISE EXCEPTION 'must not resend, got %', sent; END IF;
END;
$$;

-- 다시 설치해도 기록이 유지되고 진행 중인 응답을 기준점으로 삼지 않는다.
\ir ../supabase/survey-abandoned.sql
UPDATE public.survey_responses SET created_at = now()-interval '11 minutes' WHERE id = 4;
INSERT INTO public.survey_responses (id,completed,answers,created_at)
SELECT 100+n,false,'{}',now()-interval '20 minutes' FROM generate_series(1,4) n;

DO $$
DECLARE sent integer;
BEGIN
  SELECT landit_alerts.scan_survey_abandoned() INTO sent;
  IF sent <> 3 THEN RAISE EXCEPTION 'must cap at 3 per scan, got %', sent; END IF;
  SELECT landit_alerts.scan_survey_abandoned() INTO sent;
  IF sent <> 2 THEN RAISE EXCEPTION 'rest must go next scan, got %', sent; END IF;
  IF NOT EXISTS (SELECT 1 FROM net.test_requests WHERE body->'record'->>'id' = '4') THEN
    RAISE EXCEPTION 'reinstall must not baseline in-progress rows';
  END IF;
  IF EXISTS (SELECT 1 FROM net.test_requests WHERE body->'record'->>'id' IN ('1','5')) THEN
    RAISE EXCEPTION 'baseline and completed rows must not be sent';
  END IF;

  DELETE FROM vault.decrypted_secrets;
  UPDATE public.survey_responses SET completed = false WHERE id = 5;
  BEGIN
    PERFORM landit_alerts.scan_survey_abandoned();
    RAISE EXCEPTION 'missing secret must fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'survey webhook secret missing' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname='landit_alerts' AND a.grantee=0) THEN
    RAISE EXCEPTION 'functions must not grant PUBLIC execution';
  END IF;
END;
$$;
\echo survey abandoned ok
