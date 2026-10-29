// Safari에서 확인한 잔액과 공식 API 비용을 검증하고 디스코드 보고서를 만든다.
import { ReportError, fetchKeyCosts } from './costs.mjs';

export const BILLING_URL = 'https://platform.openai.com/settings/organization/billing/overview';
export const kstDate = (now) => new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
export const previousDate = (now) => kstDate(new Date(now.getTime() - 86400000));
const kstTimestamp = (date) => new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ') + ' KST';
const money = (n, digits = 4) => `$${n.toFixed(digits)}`;

export const validateBalance = (balance, organizationId, now) => {
  if (balance?.organizationId !== organizationId || balance?.source !== BILLING_URL)
    throw new ReportError('잔액 출처 또는 조직 ID 불일치');
  const age = now.getTime() - Date.parse(balance.observedAt);
  if (!Number.isFinite(age) || age < -60000 || age > 15 * 60000)
    throw new ReportError('잔액 확인 시각이 오래되었거나 유효하지 않습니다');
  if (balance.status === 'unavailable') return null;
  if (balance.status !== 'ok' || balance.currency !== 'usd' || !Number.isFinite(balance.usd))
    throw new ReportError('잔액 형식 오류');
  return balance.usd;
};

export const collectReport = async ({ balance, organizationId, adminKey, now = new Date(), fetchImpl = fetch }) => {
  const usd = validateBalance(balance, organizationId, now);
  const date = previousDate(now);
  let costs;
  let costError;
  try {
    costs = await fetchKeyCosts({ adminKey, organizationId, date, fetchImpl });
  } catch (error) {
    // 응답 본문과 네트워크 예외에는 인증 정보가 포함될 수 있어 그대로 내보내지 않는다.
    costError = error instanceof ReportError ? error.message : '비용 API 통신 또는 응답 해석 실패';
  }
  const lines = [
    '**OpenAI 일일 비용 보고**',
    `잔액: ${usd === null ? '확인 불가 — Safari 로그인·결제 화면 확인 필요' : `**${money(usd, 2)}**`}`,
    `잔액 확인: ${kstTimestamp(new Date(balance.observedAt))}`,
    `비용 기간: ${date} 00:00–24:00 KST`,
  ];
  let csv;
  if (costs) {
    costs.sort((a, b) => b.usd - a.usd || String(a.apiKeyId).localeCompare(String(b.apiKeyId)));
    lines.push(`전날 사용액: **${money(costs.reduce((sum, row) => sum + row.usd, 0))}**`, '', '**API 키별 비용**');
    csv = ['api_key_id,cost_usd', ...costs.map((row) => `${row.apiKeyId ?? 'unattributed'},${row.usd}`)].join('\n') + '\n';
    if (costs.length === 0) lines.push('해당 구간에 기록된 비용 없음.');
    let shown = 0;
    for (const row of costs) {
      const line = `• ${row.apiKeyId === null ? '키 미분류·공통 비용' : `\`${row.apiKeyId}\``}: ${money(row.usd)}`;
      if ([...lines, line].join('\n').length > 1450) break;
      lines.push(line);
      shown++;
    }
    if (shown < costs.length) lines.push(`전체 ${costs.length}개 항목은 첨부 CSV 참조.`);
    lines.push('조회 시점 집계이며 지연 반영·조정으로 바뀔 수 있습니다.');
  } else lines.push(`키별 비용: 확인 불가 — ${costError}`);
  lines.push(`[결제 화면](${BILLING_URL})`);
  return {
    date,
    content: lines.join('\n'),
    csv,
    complete: usd !== null && !costError,
  };
};

export const postReport = async ({ webhookUrl, report, fetchImpl = fetch }) => {
  let url;
  try { url = new URL(webhookUrl); } catch { throw new ReportError('Discord 웹훅 미설정 또는 형식 오류'); }
  if (url.origin !== 'https://discord.com' || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname) || url.username || url.password)
    throw new ReportError('Discord 웹훅 주소 형식 오류');
  url.search = '';
  url.searchParams.set('wait', 'true');
  const form = new FormData();
  form.set('payload_json', JSON.stringify({
    content: report.content,
    allowed_mentions: { parse: [] },
    ...(report.csv ? { attachments: [{ id: 0, filename: `openai-costs-${report.date}.csv` }] } : {}),
  }));
  if (report.csv) form.set('files[0]', new Blob([report.csv], { type: 'text/csv;charset=utf-8' }), `openai-costs-${report.date}.csv`);
  const response = await fetchImpl(url, { method: 'POST', body: form, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new ReportError(`Discord 전송 실패: HTTP ${response.status}`);
  const receipt = await response.json();
  if (!/^\d+$/.test(receipt.id ?? '')) throw new ReportError('Discord 전송 영수증 확인 실패');
  return receipt.id;
};
