// 슈퍼베이스(백엔드 메인 DB) 수집기 — 최고 스트릭과 시나리오 누적 최다를 읽는다.
// 둘 다 백엔드가 user_learning_activity_summary에 계산해 두고 앰플리튜드엔 없어서 여기서 직접 읽는다
import { assertOk } from '../shared/http.mjs';
import { TEAM_USER_IDS } from './amplitude.mjs';

const TABLE = 'user_learning_activity_summary';
// 최고값과 같은 사람이 이보다 많을 일은 없다 — 전체를 긁지 않는다
const LIMIT = 100;

// 내림차순 행에서 최고 스트릭과 그 값에 있는 사람들의 id — 아무도 없으면 0일에 빈 목록
export const topStreak = (rows) => {
  const top = rows[0]?.current_streak_days ?? 0;
  return {
    top,
    users: top
      ? rows
          .filter((r) => r.current_streak_days === top)
          .map((r) => r.user_profile_id)
      : [],
  };
};

// 내림차순 행에서 시나리오 누적 최다와 그 값에 있는 사람들의 id
export const topScenarios = (rows) => {
  const top = rows[0]?.completed_scenario_count ?? 0;
  return {
    top,
    users: top
      ? rows
          .filter((r) => r.completed_scenario_count === top)
          .map((r) => r.user_profile_id)
      : [],
  };
};

export const createSupabaseClient = ({ url, secretKey }) => {
  const headers = { apikey: secretKey, Authorization: `Bearer ${secretKey}` };

  const rows = async (filters, label) => {
    const params = new URLSearchParams({
      user_profile_id: `not.in.(${TEAM_USER_IDS.join(',')})`,
      limit: String(LIMIT),
      ...filters,
    });
    const res = await assertOk(
      await fetch(`${url}/rest/v1/${TABLE}?${params}`, { headers }),
      label,
    );
    return res.json();
  };

  // 백엔드 StreakService와 같은 규칙 — 마지막 학습일이 어제 이전이면 끊긴 스트릭이라 뺀다.
  // 아침에 전날 지표를 보내므로 기준일(어제) 이후 학습한 사람만 "지금 이어가는 중"이다
  const streak = async (date) =>
    topStreak(
      await rows(
        {
          select: 'user_profile_id,current_streak_days',
          last_activity_date: `gte.${date}`,
          order: 'current_streak_days.desc',
        },
        '슈퍼베이스 스트릭 조회',
      ),
    );

  // 서비스 전체에서 지금까지 시나리오를 가장 많이 끝낸 사람 — 기간과 무관한 누적
  const scenarios = async () =>
    topScenarios(
      await rows(
        {
          select: 'user_profile_id,completed_scenario_count',
          order: 'completed_scenario_count.desc',
        },
        '슈퍼베이스 시나리오 누적 조회',
      ),
    );

  // 기록 둘을 한 번에 — 한쪽만 실패해도 같이 비운다 (출처가 같아 따로 살릴 이유가 없다)
  const records = async (date) => {
    const [streakTop, scenarioTop] = await Promise.all([
      streak(date),
      scenarios(),
    ]);
    return { streak: streakTop, scenarios: scenarioTop };
  };

  return { records };
};
