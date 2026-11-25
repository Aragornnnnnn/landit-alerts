-- 복원된 RDS의 설문 저장과 지표 조회를 각각 전용 역할에 제한한다.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.survey_responses') IS NULL
    OR to_regprocedure('public.metrics_records(date,bigint[])') IS NULL THEN
    RAISE EXCEPTION 'Restore the survey table and metrics function first';
  END IF;
  IF to_regnamespace('vault') IS NOT NULL
    OR EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'The RDS integration installer cannot run against the Supabase source';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'landit_survey_bridge') THEN
    CREATE ROLE landit_survey_bridge NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'landit_metrics_bridge') THEN
    CREATE ROLE landit_metrics_bridge NOLOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO landit_survey_bridge, landit_metrics_bridge', current_database());
END;
$$;

CREATE SCHEMA IF NOT EXISTS landit_integration;
REVOKE ALL ON SCHEMA landit_integration FROM PUBLIC;
GRANT USAGE ON SCHEMA landit_integration TO landit_survey_bridge;

CREATE OR REPLACE FUNCTION landit_integration.save_survey(
  profile_id bigint, survey_kind text, response_key uuid,
  is_completed boolean, contact_email text, survey_answers jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF profile_id IS NULL OR profile_id <= 0 OR survey_kind IS NULL OR survey_kind NOT IN ('general', 'paid')
    OR is_completed IS NULL OR jsonb_typeof(survey_answers) IS DISTINCT FROM 'object' THEN
    RETURN 'invalid';
  END IF;

  PERFORM 1 FROM public.user_profile WHERE id = profile_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN 'user_missing';
  END IF;

  INSERT INTO public.survey_responses AS existing(user_id, survey, response_id, completed, email, answers)
  VALUES (profile_id, survey_kind, response_key, response_key IS NULL OR is_completed, contact_email, survey_answers)
  ON CONFLICT (user_id, response_id) DO UPDATE
    SET completed = excluded.completed, email = excluded.email, answers = excluded.answers
  WHERE existing.survey = excluded.survey AND (NOT existing.completed OR excluded.completed);

  IF NOT FOUND AND EXISTS (SELECT FROM public.survey_responses s
    WHERE s.user_id = profile_id AND s.response_id = response_key AND s.survey <> survey_kind) THEN
    RETURN 'response_conflict';
  END IF;
  RETURN 'saved';
EXCEPTION WHEN unique_violation THEN
  IF EXISTS (SELECT FROM public.survey_responses s
    WHERE s.response_id = response_key AND s.user_id <> profile_id) THEN
    RETURN 'response_conflict';
  END IF;
  RAISE;
END;
$$;
REVOKE ALL ON FUNCTION landit_integration.save_survey(bigint,text,uuid,boolean,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION landit_integration.save_survey(bigint,text,uuid,boolean,text,jsonb) TO landit_survey_bridge;

REVOKE ALL ON FUNCTION public.metrics_records(date,bigint[]) FROM PUBLIC;
DO $$
DECLARE
  role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.metrics_records(date,bigint[]) FROM %I', role_name);
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.metrics_records(date,bigint[]) TO landit_metrics_bridge;
GRANT USAGE ON SCHEMA public TO landit_metrics_bridge;
ALTER ROLE landit_metrics_bridge SET default_transaction_read_only TO on;

COMMIT;
