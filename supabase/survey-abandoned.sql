-- 시작하고 10분이 지나도록 제출하지 않은 설문 응답을 찾아 알림 수신 함수로 한 번씩 보낸다.
BEGIN;
CREATE SCHEMA IF NOT EXISTS landit_alerts;
REVOKE ALL ON SCHEMA landit_alerts FROM PUBLIC;

-- 이미 알린 응답. request_id가 비어 있으면 설치 시점의 기준점으로 넣은 행이다.
CREATE TABLE IF NOT EXISTS landit_alerts.survey_abandoned_alert (
  response_id bigint PRIMARY KEY,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  request_id bigint
);
ALTER TABLE landit_alerts.survey_abandoned_alert ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON landit_alerts.survey_abandoned_alert FROM PUBLIC;

-- 처음 설치할 때만 지금까지 쌓인 미완료 응답을 기준점으로 넣는다. 한꺼번에 알리지 않기 위해서다.
INSERT INTO landit_alerts.survey_abandoned_alert (response_id)
SELECT r.id FROM public.survey_responses r
WHERE r.completed = false
  AND NOT EXISTS (SELECT 1 FROM landit_alerts.survey_abandoned_alert);

CREATE OR REPLACE FUNCTION landit_alerts.scan_survey_abandoned()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  candidate record;
  webhook_secret text;
  queued_request bigint;
  sent_count integer := 0;
BEGIN
  -- 수동 실행과 cron이 겹쳐도 같은 응답을 두 번 보내지 않는다.
  IF NOT pg_try_advisory_xact_lock(801,1) THEN RETURN 0; END IF;

  SELECT decrypted_secret INTO webhook_secret FROM vault.decrypted_secrets
  WHERE name = 'landit_survey_webhook_secret';
  IF webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE EXCEPTION 'survey webhook secret missing';
  END IF;

  -- 디스코드 속도 제한을 넘지 않게 한 번에 3건만 보낸다. 남은 건은 다음 검사에서 보낸다.
  FOR candidate IN
    SELECT r.id, r.survey, r.user_id, r.email, r.answers, r.created_at
    FROM public.survey_responses r
    WHERE r.completed = false
      AND r.created_at < now() - interval '10 minutes'
      AND NOT EXISTS (SELECT 1 FROM landit_alerts.survey_abandoned_alert a
        WHERE a.response_id = r.id)
    ORDER BY r.created_at, r.id LIMIT 3
  LOOP
    queued_request := net.http_post(
      url := 'https://landit-alerts.vercel.app/api/survey',
      headers := jsonb_build_object('Content-Type','application/json','x-survey-secret',webhook_secret),
      body := jsonb_build_object('type','SURVEY_ABANDONED','table','survey_responses',
        'record',jsonb_build_object('id',candidate.id,'survey',candidate.survey,
          'user_id',candidate.user_id,'email',candidate.email,
          'answers',candidate.answers,'created_at',candidate.created_at)),
      timeout_milliseconds := 10000);
    INSERT INTO landit_alerts.survey_abandoned_alert (response_id,request_id)
    VALUES (candidate.id,queued_request);
    sent_count := sent_count + 1;
  END LOOP;
  RETURN sent_count;
END;
$$;
REVOKE ALL ON FUNCTION landit_alerts.scan_survey_abandoned() FROM PUBLIC;
COMMIT;
