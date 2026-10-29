// OpenRouter의 현재 크레딧 잔액과 완료된 UTC 하루의 키별 청구 비용을 조회한다.
import { ReportError, utcDayRange } from '../openai/costs.mjs';

const request = async (path, managementKey, fetchImpl, body) => {
  if (!managementKey) throw new ReportError('OpenRouter Management API key 미설정');
  const response = await fetchImpl(`https://openrouter.ai/api/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${managementKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new ReportError(`OpenRouter 조회 실패: HTTP ${response.status}`);
  return response.json();
};

export const fetchBalance = async ({ managementKey, fetchImpl = fetch }) => {
  const { data } = await request('credits', managementKey, fetchImpl);
  if (!Number.isFinite(data?.total_credits) || !Number.isFinite(data?.total_usage))
    throw new ReportError('OpenRouter 잔액 응답 형식 오류');
  const balance = data.total_credits - data.total_usage;
  if (!Number.isFinite(balance)) throw new ReportError('OpenRouter 잔액 계산 오류');
  return balance;
};

export const fetchRouterKeyCosts = async ({ managementKey, date, fetchImpl = fetch }) => {
  const { start, end } = utcDayRange(date);
  const { data } = await request('analytics/query', managementKey, fetchImpl, {
    // BYOK 추론비는 원 공급자 보고에 포함되므로 OpenRouter 크레딧 청구분만 집계한다.
    metrics: ['credits_usage'], dimensions: ['api_key_id'], granularity: 'day', limit: 10000,
    time_range: { start: new Date(start * 1000).toISOString(), end: new Date(end * 1000).toISOString() },
  });
  if (!Array.isArray(data?.data) || data.metadata?.truncated !== false ||
      data.metadata.row_count !== data.data.length)
    throw new ReportError('OpenRouter 비용 응답이 불완전하거나 잘렸습니다');
  const costs = [];
  for (const row of data.data) {
    if (Date.parse(row.date__day) !== start * 1000 || !Number.isFinite(row.credits_usage))
      throw new ReportError('OpenRouter 비용 날짜 또는 금액 형식 오류');
    // Analytics API가 키 ID를 이름으로 변환한다. 삭제된 키·키 없는 사용도 누락하지 않는다.
    const name = row.api_key_id === null ? '키 미분류·공통 비용' : row.api_key_id;
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\x00-\x1f\x7f]/.test(name) || name.startsWith('sk-'))
      throw new ReportError('OpenRouter 키 이름 형식 오류');
    costs.push({ name, usd: row.credits_usage });
  }
  if (!Number.isFinite(costs.reduce((sum, row) => sum + row.usd, 0)))
    throw new ReportError('OpenRouter 비용 합계 오류');
  return costs.sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name));
};
