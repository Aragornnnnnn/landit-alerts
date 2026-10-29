// OpenAI 조직의 전날 한국 시간 기준 API 키별 비용을 조회한다.
const API_URL = 'https://api.openai.com/v1/organization/costs';

export const kstDayRange = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜 형식 오류');
  const start = Date.parse(`${date}T00:00:00+09:00`);
  if (!Number.isFinite(start) || new Date(start + 9 * 3600000).toISOString().slice(0, 10) !== date)
    throw new Error('유효하지 않은 날짜');
  return { start: start / 1000, end: start / 1000 + 86400 };
};

export const fetchKeyCosts = async ({ adminKey, date, fetchImpl = fetch }) => {
  if (!adminKey) throw new Error('OpenAI 관리자 키가 없습니다');
  const { start, end } = kstDayRange(date);
  const totals = new Map();
  const seen = new Set();
  let page;
  do {
    const url = new URL(API_URL);
    url.searchParams.set('start_time', String(start));
    url.searchParams.set('end_time', String(end));
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.append('group_by[]', 'api_key_id');
    if (page) url.searchParams.set('page', page);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${adminKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`OpenAI 비용 조회 실패: HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.data)) throw new Error('OpenAI 비용 응답 형식 오류');
    for (const bucket of result.data) {
      if (bucket.start_time < start || bucket.end_time > end || bucket.end_time <= bucket.start_time)
        throw new Error('비용 집계 구간이 요청한 한국 시간 범위와 다릅니다');
      if (!Array.isArray(bucket.results)) throw new Error('OpenAI 비용 결과 형식 오류');
      for (const item of bucket.results) {
        if (item.amount?.currency !== 'usd' || !Number.isFinite(item.amount?.value))
          throw new Error('OpenAI 비용 금액 또는 통화 오류');
        const key = item.api_key_id ?? null;
        totals.set(key, (totals.get(key) ?? 0) + item.amount.value);
      }
    }
    if (result.has_more) {
      if (!result.next_page || seen.has(result.next_page)) throw new Error('비용 페이지 커서 오류');
      seen.add(result.next_page);
      page = result.next_page;
    } else page = undefined;
  } while (page);
  return [...totals].map(([apiKeyId, usd]) => ({ apiKeyId, usd }));
};
