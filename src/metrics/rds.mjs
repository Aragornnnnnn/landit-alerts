// RDS 전환 후 기존 스트릭·시나리오 지표를 인증된 서버 경로에서 조회한다.
import { assertOk } from '../shared/http.mjs';
import { TEAM_USER_IDS } from './amplitude.mjs';
import { recordsFromResponse } from './supabase.mjs';

export const createRdsClient = ({ url, token, fetchImpl = fetch }) => {
  if (new URL(url).protocol !== 'https:') {
    throw new Error('RDS 지표 조회 URL은 HTTPS여야 합니다.');
  }

  const records = async (date) => {
    const response = await assertOk(
      await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_date: date, excluded_ids: TEAM_USER_IDS.map(Number) }),
      }),
      'RDS 기록 조회',
    );
    return recordsFromResponse(await response.json());
  };

  return { records };
};
