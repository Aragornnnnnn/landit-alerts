// OpenAI 조직의 한국 시간 기준 API 키별 비용을 조회하고 집계 범위를 검증한다.
const API_URL = 'https://api.openai.com/v1/organization/costs';

export class ReportError extends Error {}

export const kstDayRange = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ReportError('날짜 형식 오류');
  const start = Date.parse(`${date}T00:00:00+09:00`);
  if (!Number.isFinite(start) || new Date(start + 9 * 3600000).toISOString().slice(0, 10) !== date)
    throw new ReportError('유효하지 않은 날짜');
  return { start: start / 1000, end: start / 1000 + 86400 };
};

export const fetchKeyCosts = async ({ adminKey, organizationId, date, fetchImpl = fetch }) => {
  if (!adminKey) throw new ReportError('OpenAI Admin API key 미설정');
  if (!/^org-[A-Za-z0-9]+$/.test(organizationId ?? ''))
    throw new ReportError('OpenAI 조직 ID 미설정 또는 형식 오류');
  const { start, end } = kstDayRange(date);
  const totals = new Map();
  const seen = new Set();
  const intervals = new Map();
  const rows = new Set();
  let page;
  let pageCount = 0;
  do {
    if (++pageCount > 100) throw new ReportError('비용 페이지 한도 초과');
    const url = new URL(API_URL);
    url.searchParams.set('start_time', String(start));
    url.searchParams.set('end_time', String(end));
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.append('group_by[]', 'api_key_id');
    if (page) url.searchParams.set('page', page);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${adminKey}`, 'OpenAI-Organization': organizationId },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.ok) throw new ReportError(`OpenAI 비용 조회 실패: HTTP ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.data) || typeof result.has_more !== 'boolean')
      throw new ReportError('OpenAI 비용 응답 형식 오류');
    for (const bucket of result.data) {
      if (!Number.isInteger(bucket.start_time) || !Number.isInteger(bucket.end_time) ||
          bucket.start_time < start || bucket.end_time > end || bucket.end_time <= bucket.start_time)
        throw new ReportError('비용 집계 구간이 요청한 한국 시간 범위와 다릅니다');
      intervals.set(`${bucket.start_time}:${bucket.end_time}`, [bucket.start_time, bucket.end_time]);
      if (!Array.isArray(bucket.results)) throw new ReportError('OpenAI 비용 결과 형식 오류');
      for (const item of bucket.results) {
        if (item.amount?.currency !== 'usd' || !Number.isFinite(item.amount?.value))
          throw new ReportError('OpenAI 비용 금액 또는 통화 오류');
        // 비밀 키 값은 이 필드에 올 수 없다. ID만 출력한다.
        const key = item.api_key_id ?? null;
        if (key !== null && (typeof key !== 'string' || !/^[\w-]{1,200}$/.test(key) || key.startsWith('sk-')))
          throw new ReportError('OpenAI API 키 ID 형식 오류');
        const rowId = JSON.stringify([bucket.start_time, bucket.end_time, key]);
        if (rows.has(rowId)) throw new ReportError('중복 비용 행으로 집계할 수 없습니다');
        rows.add(rowId);
        const total = (totals.get(key) ?? 0) + item.amount.value;
        if (!Number.isFinite(total)) throw new ReportError('OpenAI 비용 합계 오류');
        totals.set(key, total);
      }
    }
    if (result.has_more) {
      if (typeof result.next_page !== 'string' || !result.next_page || seen.has(result.next_page))
        throw new ReportError('비용 페이지 커서 오류');
      seen.add(result.next_page);
      page = result.next_page;
    } else page = undefined;
  } while (page);
  // 빈 응답이나 구간 누락을 사용액 0으로 오인하지 않는다.
  let cursor = start;
  for (const [from, to] of [...intervals.values()].sort((a, b) => a[0] - b[0])) {
    if (from !== cursor) throw new ReportError('비용 집계 구간이 누락되거나 겹칩니다');
    cursor = to;
  }
  if (cursor !== end) throw new ReportError('비용 집계 구간이 완전하지 않습니다');
  return [...totals].map(([apiKeyId, usd]) => ({ apiKeyId, usd }));
};
