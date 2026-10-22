-- 레퍼럴 관계 INSERT를 커밋 후 Vercel에 전달하며 비밀값은 Supabase Vault에서 읽는다.
-- 운영 DB에서만 postgres 관리자로 적용한다. 사전 설정과 해제는 docs/referral.md 참고.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.referral') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'referral table, Vault and pg_net must be installed first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'landit_referral_webhook_secret' AND decrypted_secret <> ''
  ) THEN
    RAISE EXCEPTION 'Configure landit_referral_webhook_secret in Vault first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_landit_referral()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  webhook_secret text;
BEGIN
  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'landit_referral_webhook_secret';

  IF webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING 'referral notification skipped: webhook secret missing';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://landit-alerts.vercel.app/api/referral',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'x-referral-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT', 'schema', 'public', 'table', 'referral', 'old_record', NULL,
      'record', jsonb_build_object(
        'id', NEW.id::text, 'inviter_id', NEW.inviter_id::text,
        'invitee_id', NEW.invitee_id::text, 'registered_at', NEW.registered_at
      )
    ),
    timeout_milliseconds := 10000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- 큐 기록 실패가 업무 트랜잭션을 막지 않게 한다. 오류 원문에는 비밀값이 포함될 수 있다.
  RAISE WARNING 'referral notification enqueue failed (SQLSTATE=%)', SQLSTATE;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_landit_referral() FROM PUBLIC;

DROP TRIGGER IF EXISTS landit_referral_insert_alert ON public.referral;
CREATE TRIGGER landit_referral_insert_alert
AFTER INSERT ON public.referral
FOR EACH ROW EXECUTE FUNCTION public.notify_landit_referral();

COMMIT;
