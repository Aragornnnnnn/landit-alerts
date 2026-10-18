// 슈퍼베이스(백엔드 메인 DB) 수집기 — 최고 스트릭을 읽는다.
// 스트릭은 백엔드가 user_learning_activity_summary에 계산해 두고 앰플리튜드엔 없어서 여기서 직접 읽는다
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

export const createSupabaseClient = ({ url, secretKey }) => {
  const headers = { apikey: secretKey, Authorization: `Bearer ${secretKey}` };

  // 백엔드 StreakService와 같은 규칙 — 마지막 학습일이 어제 이전이면 끊긴 스트릭이라 뺀다.
  // 아침에 전날 지표를 보내므로 기준일(어제) 이후 학습한 사람만 "지금 이어가는 중"이다
  const streak = async (date) => {
    const params = new URLSearchParams({
      select: 'user_profile_id,current_streak_days',
      last_activity_date: `gte.${date}`,
      user_profile_id: `not.in.(${TEAM_USER_IDS.join(',')})`,
      order: 'current_streak_days.desc',
      limit: String(LIMIT),
    });
    const res = await assertOk(
      await fetch(`${url}/rest/v1/${TABLE}?${params}`, { headers }),
      '슈퍼베이스 스트릭 조회',
    );
    return topStreak(await res.json());
  };

  return { streak };
};
