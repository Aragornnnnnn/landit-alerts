-- RDS에서 편지함·추천인 알림을 트랜잭션과 함께 저장하고 호스트 발송기에 전달한다.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_net') OR to_regnamespace('vault') IS NOT NULL THEN
    RAISE EXCEPTION 'The RDS notification installer cannot run against the Supabase source';
  END IF;
END;
$$;
\ir ../supabase/referral-risk.sql

BEGIN;

CREATE TABLE IF NOT EXISTS landit_alerts.rds_webhook_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'complete', 'unknown')),
  claimed_at timestamptz,
  http_status integer,
  confirmed_sent boolean NOT NULL DEFAULT false
);
ALTER TABLE landit_alerts.rds_webhook_outbox DROP CONSTRAINT IF EXISTS rds_webhook_outbox_channel_check;
ALTER TABLE landit_alerts.rds_webhook_outbox ADD CONSTRAINT rds_webhook_outbox_channel_check
  CHECK (channel IN ('feedback', 'referral', 'survey'));

CREATE INDEX IF NOT EXISTS rds_webhook_pending ON landit_alerts.rds_webhook_outbox(id) WHERE status = 'pending';
ALTER TABLE landit_alerts.rds_webhook_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON landit_alerts.rds_webhook_outbox FROM PUBLIC;

-- 이전 pg_net 요청 번호와 RDS의 새 요청 번호가 겹치지 않도록 한다.
SELECT setval('landit_alerts.rds_webhook_outbox_id_seq',
  greatest((SELECT last_value FROM landit_alerts.rds_webhook_outbox_id_seq),
           (SELECT coalesce(max(request_id), 1) FROM landit_alerts.referral_risk_event)));

CREATE OR REPLACE FUNCTION landit_alerts.validate_referral_transport()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 'landit_alerts.rds_webhook_outbox'::regclass;
END;
$$;

CREATE OR REPLACE FUNCTION landit_alerts.enqueue_referral_webhook(payload jsonb)
RETURNS bigint LANGUAGE sql SET search_path = '' AS $$
  INSERT INTO landit_alerts.rds_webhook_outbox(channel, payload)
  VALUES ('referral', payload) RETURNING id;
$$;

CREATE OR REPLACE FUNCTION landit_alerts.referral_http_responses()
RETURNS TABLE (id bigint, status_code integer, content text)
LANGUAGE sql SET search_path = '' AS $$
  SELECT q.id, q.http_status, jsonb_build_object('sent', q.confirmed_sent)::text
  FROM landit_alerts.referral_risk_event e
  JOIN landit_alerts.rds_webhook_outbox q ON q.id = e.request_id
  WHERE e.delivery_status = 'queued' AND q.channel = 'referral' AND q.http_status IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION landit_alerts.capture_feedback()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO landit_alerts.rds_webhook_outbox(channel, payload)
  VALUES ('feedback', jsonb_build_object('type','INSERT','schema','public','table','mailbox_feedback',
    'record', jsonb_build_object('id',NEW.id,'user_profile_id',NEW.user_profile_id,
      'feedback_type',NEW.feedback_type,'content_text',NEW.content_text,'created_at',NEW.created_at)));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'feedback notification enqueue failed (SQLSTATE=%)', SQLSTATE;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION landit_alerts.capture_survey()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  prior_record jsonb;
BEGIN
  IF NEW.completed IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.completed IS DISTINCT FROM false THEN
      RETURN NEW;
    END IF;
    prior_record := jsonb_build_object('completed', OLD.completed);
  END IF;
  INSERT INTO landit_alerts.rds_webhook_outbox(channel, payload)
  VALUES ('survey', jsonb_build_object('type',TG_OP,'schema','public','table','survey_responses',
    'old_record', prior_record,
    'record', jsonb_build_object('id',NEW.id,'user_id',NEW.user_id,'survey',NEW.survey,
      'email',NEW.email,'answers',NEW.answers,'created_at',NEW.created_at,'completed',NEW.completed)));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'survey notification enqueue failed (SQLSTATE=%)', SQLSTATE;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION landit_alerts.capture_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  inviter_nickname text;
  invitee_nickname text;
BEGIN
  BEGIN
    SELECT nickname INTO inviter_nickname FROM public.user_profile WHERE id = NEW.inviter_id;
    SELECT nickname INTO invitee_nickname FROM public.user_profile WHERE id = NEW.invitee_id;
  EXCEPTION WHEN OTHERS THEN
    inviter_nickname := NULL;
    invitee_nickname := NULL;
    RAISE WARNING 'referral nickname lookup failed (SQLSTATE=%)', SQLSTATE;
  END;
  PERFORM landit_alerts.enqueue_referral_webhook(
    jsonb_build_object('type','INSERT','schema','public','table','referral','old_record',NULL,
      'record',jsonb_build_object('id',NEW.id::text,'inviter_id',NEW.inviter_id::text,
        'invitee_id',NEW.invitee_id::text,'registered_at',NEW.registered_at,
        'inviter_nickname',inviter_nickname,'invitee_nickname',invitee_nickname)));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'referral notification enqueue failed (SQLSTATE=%)', SQLSTATE;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION landit_alerts.capture_feedback() FROM PUBLIC;
REVOKE ALL ON FUNCTION landit_alerts.capture_referral() FROM PUBLIC;
REVOKE ALL ON FUNCTION landit_alerts.capture_survey() FROM PUBLIC;
DROP TRIGGER IF EXISTS "feedback-discord" ON public.mailbox_feedback;
CREATE TRIGGER "feedback-discord" AFTER INSERT ON public.mailbox_feedback
FOR EACH ROW EXECUTE FUNCTION landit_alerts.capture_feedback();
DROP TRIGGER IF EXISTS "survey-discord" ON public.survey_responses;
CREATE TRIGGER "survey-discord" AFTER INSERT OR UPDATE ON public.survey_responses
FOR EACH ROW EXECUTE FUNCTION landit_alerts.capture_survey();
DROP TRIGGER IF EXISTS landit_referral_insert_alert ON public.referral;
CREATE TRIGGER landit_referral_insert_alert AFTER INSERT ON public.referral
FOR EACH ROW EXECUTE FUNCTION landit_alerts.capture_referral();

CREATE OR REPLACE FUNCTION landit_alerts.claim_webhook()
RETURNS TABLE (id bigint, channel text, payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- 발송 후 연결이 끊겼을 수 있으므로 이미 가져간 요청은 자동 재발송하지 않는다.
  UPDATE landit_alerts.rds_webhook_outbox q SET status = 'unknown', payload = NULL
  WHERE q.status = 'sending' AND q.claimed_at < now() - interval '15 minutes';
  RETURN QUERY UPDATE landit_alerts.rds_webhook_outbox q SET status = 'sending', claimed_at = now()
  WHERE q.id = (SELECT pending.id FROM landit_alerts.rds_webhook_outbox pending
                WHERE pending.status = 'pending' ORDER BY pending.id LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING q.id, q.channel, q.payload;
END;
$$;

CREATE OR REPLACE FUNCTION landit_alerts.finish_webhook(event_id bigint, response_status integer, sent boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE landit_alerts.rds_webhook_outbox
  SET status = CASE WHEN response_status IS NULL THEN 'unknown' ELSE 'complete' END,
      http_status = response_status, confirmed_sent = sent, payload = NULL
  WHERE id = event_id AND status = 'sending';
$$;
REVOKE ALL ON FUNCTION landit_alerts.claim_webhook() FROM PUBLIC;
REVOKE ALL ON FUNCTION landit_alerts.finish_webhook(bigint,integer,boolean) FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'landit_alerts_dispatcher') THEN
    CREATE ROLE landit_alerts_dispatcher NOLOGIN;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA landit_alerts TO landit_alerts_dispatcher;
GRANT EXECUTE ON FUNCTION landit_alerts.scan_referral_risk(), landit_alerts.claim_webhook(),
  landit_alerts.finish_webhook(bigint,integer,boolean) TO landit_alerts_dispatcher;

COMMIT;
