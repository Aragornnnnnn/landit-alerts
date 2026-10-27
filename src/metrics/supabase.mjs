// 슈퍼베이스(백엔드 메인 DB) 수집기 — 최고 스트릭과 시나리오 누적 최다를 읽는다.
// 표를 직접 읽지 않고 읽기 전용 함수(sql/metrics_records.sql) 하나만 부른다. 그래서 공개 키로도 충분하다
import { assertOk } from '../shared/http.mjs';
import { TEAM_USER_IDS } from './amplitude.mjs';

const FUNCTION = 'metrics_records';

const isIdList = (value) =>
  Array.isArray(value) && value.every((id) => Number.isInteger(id));

const isRecord = (value) =>
  Number.isInteger(value?.top) && isIdList(value?.users);

// 함수 응답을 그대로 쓰되 모양이 다르면 던진다 — 틀린 숫자를 내보내느니 줄을 숨긴다
export const recordsFromResponse = (data) => {
  if (!isRecord(data?.streak) || !isRecord(data?.scenarios))
    throw new Error(
      `슈퍼베이스 기록 응답 모양이 다름: ${JSON.stringify(data)}`,
    );
  return { streak: data.streak, scenarios: data.scenarios };
};

export const createSupabaseClient = ({ url, secretKey }) => {
  // 새 키 체계(sb_publishable_…)는 apikey 헤더에만 싣는다 — Authorization에 넣으면 사용자 토큰으로 오인된다
  const headers = { apikey: secretKey, 'Content-Type': 'application/json' };

  // 기준일(어제) 이후 학습한 사람만 "지금 이어가는 중"이다. 누적 최다는 기간과 무관하다
  const records = async (date) => {
    const res = await assertOk(
      await fetch(`${url}/rest/v1/rpc/${FUNCTION}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          target_date: date,
          excluded_ids: TEAM_USER_IDS.map(Number),
        }),
      }),
      '슈퍼베이스 기록 조회',
    );
    return recordsFromResponse(await res.json());
  };

  return { records };
};
