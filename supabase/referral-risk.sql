-- 초대 급증과 환불 집중을 집계하고 운영 알림 설정·발송 이력을 별도 스키마에 보존한다.
BEGIN;
CREATE SCHEMA IF NOT EXISTS landit_alerts;
REVOKE ALL ON SCHEMA landit_alerts FROM PUBLIC;

CREATE TABLE IF NOT EXISTS landit_alerts.referral_risk_rule (
  code text PRIMARY KEY CHECK (code IN ('INVITE_BURST','INVITE_DAILY','REFUND_RATIO')),
  enabled boolean NOT NULL DEFAULT true,
  window_minutes integer NOT NULL CHECK (window_minutes BETWEEN 1 AND 10080),
  min_count integer NOT NULL CHECK (min_count BETWEEN 1 AND 1000000),
  threshold_percent integer CHECK (threshold_percent BETWEEN 1 AND 100),
  cooldown_minutes integer NOT NULL CHECK (cooldown_minutes BETWEEN 1 AND 10080),
  CHECK ((code = 'REFUND_RATIO') = (threshold_percent IS NOT NULL))
);
INSERT INTO landit_alerts.referral_risk_rule
  (code,window_minutes,min_count,threshold_percent,cooldown_minutes)
VALUES ('INVITE_BURST',10,3,NULL,60), ('INVITE_DAILY',1440,10,NULL,1440),
       ('REFUND_RATIO',10080,5,50,1440)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS landit_alerts.referral_risk_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_code text NOT NULL REFERENCES landit_alerts.referral_risk_rule(code),
  inviter_id bigint NOT NULL,
  detected_at timestamptz NOT NULL,
  observed_count bigint NOT NULL,
  matched_count bigint NOT NULL,
  window_minutes integer NOT NULL,
  min_count integer NOT NULL,
  threshold_percent integer,
  evidence_referral_ids text[] NOT NULL,
  request_id bigint UNIQUE,
  queued_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','queued','delivered','failed','unknown')),
  http_status integer
);
CREATE INDEX IF NOT EXISTS referral_risk_event_cooldown
  ON landit_alerts.referral_risk_event(rule_code,inviter_id,detected_at DESC);
ALTER TABLE landit_alerts.referral_risk_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE landit_alerts.referral_risk_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA landit_alerts FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA landit_alerts FROM PUBLIC;

CREATE OR REPLACE FUNCTION landit_alerts.evaluate_referral_risk(p_at timestamptz DEFAULT now())
RETURNS TABLE (
  rule_code text, inviter_id bigint, observed_count bigint, matched_count bigint,
  window_minutes integer, min_count integer, threshold_percent integer,
  cooldown_minutes integer, evidence_referral_ids text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH invites AS (
    SELECT c.code, r.inviter_id, count(*) AS total, c.window_minutes, c.min_count,
           c.threshold_percent, c.cooldown_minutes,
           (array_agg(r.id::text ORDER BY r.registered_at DESC,r.id DESC))[1:10] AS evidence
    FROM landit_alerts.referral_risk_rule c
    JOIN public.referral r ON r.registered_at > p_at - make_interval(mins => c.window_minutes)
      AND r.registered_at <= p_at
    WHERE c.enabled AND c.code IN ('INVITE_BURST','INVITE_DAILY')
    GROUP BY c.code,r.inviter_id
    HAVING count(*) >= c.min_count
  ), purchases AS (
    -- 확정된 첫 결제 한 건당 한 행. 양쪽 보상과 중복 결제 웹훅은 분모를 늘리지 않는다.
    SELECT c.code,r.inviter_id,r.id,i.purchased_at,c.window_minutes,c.min_count,
           c.threshold_percent,c.cooldown_minutes,
           EXISTS (SELECT 1 FROM public.referral_reward_grant g
             WHERE g.referral_id=r.id AND g.stage='PURCHASE' AND g.status='REVERSED') AS refunded
    FROM landit_alerts.referral_risk_rule c
    JOIN public.referral_purchase_claim pc ON c.code='REFUND_RATIO' AND c.enabled
    JOIN public.referral r ON r.id=pc.referral_id
    JOIN public.referral_billing_inbox i ON i.id=pc.billing_id
    WHERE pc.environment='PRODUCTION'
      AND i.purchased_at > p_at - make_interval(mins => c.window_minutes)
      AND i.purchased_at <= p_at
  ), refunds AS (
    SELECT code,inviter_id,count(*) AS total,count(*) FILTER (WHERE refunded) AS refunded,
           window_minutes,min_count,threshold_percent,cooldown_minutes,
           (array_agg(id::text ORDER BY purchased_at DESC,id DESC) FILTER (WHERE refunded))[1:10] AS evidence
    FROM purchases
    GROUP BY code,inviter_id,window_minutes,min_count,threshold_percent,cooldown_minutes
    HAVING count(*) >= min_count
      AND count(*) FILTER (WHERE refunded) * 100 >= count(*) * threshold_percent
  )
  SELECT code,inviter_id,total,total,window_minutes,min_count,threshold_percent,cooldown_minutes,evidence
  FROM invites
  UNION ALL
  SELECT code,inviter_id,total,refunded,window_minutes,min_count,threshold_percent,cooldown_minutes,evidence
  FROM refunds;
$$;

CREATE OR REPLACE FUNCTION landit_alerts.referral_delivery_ok(status integer, body text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  RETURN COALESCE(status=200 AND body::jsonb->>'sent'='true',false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION landit_alerts.referral_delivery_ok(integer,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION landit_alerts.scan_referral_risk()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  checked_at timestamptz := now();
  candidate record;
  webhook_secret text;
  event_id bigint;
  queued_request bigint;
  sent_count integer := 0;
  nickname text;
BEGIN
  -- 수동 실행과 cron이 겹쳐도 같은 검사·발송 예약은 한 번만 진행한다.
  IF NOT pg_try_advisory_xact_lock(696,16) THEN RETURN 0; END IF;

  UPDATE landit_alerts.referral_risk_event e
  SET delivery_status=CASE WHEN landit_alerts.referral_delivery_ok(h.status_code,h.content)
                          THEN 'delivered' ELSE 'failed' END,
      http_status=h.status_code
  FROM net._http_response h WHERE e.request_id=h.id AND e.delivery_status='queued';
  UPDATE landit_alerts.referral_risk_event SET delivery_status='unknown'
  WHERE delivery_status='queued' AND queued_at < checked_at-interval '15 minutes';

  SELECT decrypted_secret INTO webhook_secret FROM vault.decrypted_secrets
  WHERE name='landit_referral_webhook_secret';
  IF webhook_secret IS NULL OR webhook_secret='' THEN
    RAISE EXCEPTION 'referral risk webhook secret missing';
  END IF;

  FOR candidate IN SELECT * FROM landit_alerts.evaluate_referral_risk(checked_at) ORDER BY rule_code,inviter_id LOOP
    IF EXISTS (SELECT 1 FROM landit_alerts.referral_risk_event e
      WHERE e.rule_code=candidate.rule_code AND e.inviter_id=candidate.inviter_id
        AND (e.delivery_status='pending'
          OR e.detected_at > checked_at-make_interval(mins => candidate.cooldown_minutes))) THEN
      CONTINUE;
    END IF;
    INSERT INTO landit_alerts.referral_risk_event
      (rule_code,inviter_id,detected_at,observed_count,matched_count,window_minutes,
       min_count,threshold_percent,evidence_referral_ids)
    VALUES (candidate.rule_code,candidate.inviter_id,checked_at,candidate.observed_count,
       candidate.matched_count,candidate.window_minutes,candidate.min_count,
       candidate.threshold_percent,candidate.evidence_referral_ids);
  END LOOP;

  -- 후보는 모두 보존하고 발송만 제한한다. 시간 창을 벗어나도 대기 경고는 유실되지 않는다.
  FOR candidate IN
    SELECT e.* FROM landit_alerts.referral_risk_event e
    JOIN landit_alerts.referral_risk_rule c ON c.code=e.rule_code AND c.enabled
    WHERE e.delivery_status='pending' ORDER BY e.id LIMIT 3 FOR UPDATE OF e
  LOOP
    event_id := candidate.id;
    SELECT u.nickname INTO nickname FROM public.user_profile u WHERE u.id=candidate.inviter_id;
    queued_request := net.http_post(
      url := 'https://landit-alerts.vercel.app/api/referral',
      headers := jsonb_build_object('Content-Type','application/json','x-referral-secret',webhook_secret),
      body := jsonb_build_object('type','REFERRAL_RISK','schema','landit_alerts',
        'table','referral_risk_event','record',jsonb_build_object(
          'id',event_id::text,'rule_code',candidate.rule_code,
          'inviter_id',candidate.inviter_id::text,'inviter_nickname',nickname,
          'detected_at',candidate.detected_at,'observed_count',candidate.observed_count,
          'matched_count',candidate.matched_count,'window_minutes',candidate.window_minutes,
          'min_count',candidate.min_count,'threshold_percent',candidate.threshold_percent,
          'evidence_referral_ids',candidate.evidence_referral_ids)),
      timeout_milliseconds := 10000);
    UPDATE landit_alerts.referral_risk_event SET request_id=queued_request,
      delivery_status='queued',queued_at=checked_at WHERE id=event_id;
    sent_count := sent_count+1;
  END LOOP;
  RETURN sent_count;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'referral risk scan failed (SQLSTATE=%)', SQLSTATE;
END;
$$;
REVOKE ALL ON FUNCTION landit_alerts.evaluate_referral_risk(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION landit_alerts.scan_referral_risk() FROM PUBLIC;
COMMIT;
