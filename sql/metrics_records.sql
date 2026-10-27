-- 지표 봇이 최고 스트릭·시나리오 누적 최다만 읽게 하는 읽기 전용 함수. 슈퍼베이스 SQL 편집기에서 한 번 실행한다
-- 공개 키(anon)는 이 함수만 부를 수 있고, 표를 직접 읽거나 쓰지 못한다
create function public.metrics_records(target_date date, excluded_ids bigint[])
returns json
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select user_profile_id, current_streak_days, completed_scenario_count, last_activity_date
    from public.user_learning_activity_summary
    where not (user_profile_id = any (coalesce(excluded_ids, '{}'::bigint[])))
  ),
  -- 백엔드 StreakService처럼 마지막 학습일이 기준일 이전이면 끊긴 스트릭이다
  st as (
    select coalesce(max(current_streak_days), 0) as top
    from s
    where last_activity_date >= target_date
  ),
  sc as (
    select coalesce(max(completed_scenario_count), 0) as top
    from s
  )
  select json_build_object(
    'streak', json_build_object(
      'top', st.top,
      'users', coalesce((
        select json_agg(user_profile_id order by user_profile_id)
        from s
        where st.top > 0 and current_streak_days = st.top and last_activity_date >= target_date
      ), '[]'::json)
    ),
    'scenarios', json_build_object(
      'top', sc.top,
      'users', coalesce((
        select json_agg(user_profile_id order by user_profile_id)
        from s
        where sc.top > 0 and completed_scenario_count = sc.top
      ), '[]'::json)
    )
  )
  from st, sc;
$$;

-- 슈퍼베이스는 새 함수에 실행 권한을 기본으로 열어 둔다 — 전부 닫고 anon에게만 연다
revoke all on function public.metrics_records(date, bigint[]) from public, anon, authenticated;
grant execute on function public.metrics_records(date, bigint[]) to anon;

comment on function public.metrics_records(date, bigint[]) is
  'landit-alerts 지표: 최고 스트릭과 시나리오 누적 최다만 돌려준다 (읽기 전용)';

-- 확인 — 숫자 두 개와 id가 나오면 된다
select public.metrics_records(current_date - 1, array[1,2,3,4,5,7,11,12,34,35,36,37,38,39,172,297,327,465,467,470,476,477,480,509,141,1035,1411,1476,2798,2827]::bigint[]);
