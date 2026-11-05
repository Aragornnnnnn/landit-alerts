-- 설문 이탈 검사를 운영 Supabase에서 매분 실행하도록 등록한다.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('landit-survey-abandoned','* * * * *',
  $$SET statement_timeout='20s'; SELECT landit_alerts.scan_survey_abandoned();$$);
COMMIT;
