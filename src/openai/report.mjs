// 공식 API 비용을 키 이름별로 표시하고 파일 첨부 없이 디스코드 보고서를 만든다.
import { ReportError, fetchKeyCosts, utcDayRange } from './costs.mjs';
import { fetchBalance, fetchRouterKeyCosts } from '../openrouter/costs.mjs';

export const BILLING_URL = 'https://platform.openai.com/settings/organization/billing/overview';
export const previousDate = (now) => new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
const money = (n) => `$${n.toFixed(4)}`;
const escapeName = (name) => name.replace(/[\\`*_~|<>]/g, '\\$&');

export const parseKeyNames = (json = '{}') => {
  let names;
  try { names = JSON.parse(json); } catch { throw new ReportError('OPENAI_KEY_NAMES JSON 형식 오류'); }
  if (!names || typeof names !== 'object' || Array.isArray(names)) throw new ReportError('OPENAI_KEY_NAMES 형식 오류');
  for (const [id, name] of Object.entries(names)) {
    if (!/^[\w-]{1,200}$/.test(id) || id.startsWith('sk-') || typeof name !== 'string' ||
        !name.trim() || name.length > 80 || /[\r\n\x00-\x1f]/.test(name))
      throw new ReportError('OPENAI_KEY_NAMES의 키 ID 또는 이름 형식 오류');
  }
  return names;
};

export const collectReport = async ({ organizationId, adminKey, openRouterManagementKey, keyNames = {}, now = new Date(), date = previousDate(now), fetchImpl = fetch }) => {
  const { end } = utcDayRange(date);
  if (end * 1000 > now.getTime()) throw new ReportError('완료되지 않은 날짜의 비용은 보고하지 않습니다');
  const [ai, balance, router] = await Promise.allSettled([
    fetchKeyCosts({ adminKey, organizationId, date, fetchImpl }),
    fetchBalance({ managementKey: openRouterManagementKey, fetchImpl }),
    fetchRouterKeyCosts({ managementKey: openRouterManagementKey, date, fetchImpl }),
  ]);
  const failure = (result) => result.reason instanceof ReportError ? result.reason.message : 'API 통신 또는 응답 해석 실패';
  const costs = ai.status === 'fulfilled' ? ai.value : undefined;
  const lines = [
    '**API 일일 비용 보고**',
    `비용 기간: ${date} 00:00–24:00 UTC`,
    `한국 시간: ${date} 09:00–${new Date(end * 1000).toISOString().slice(0, 10)} 09:00 KST`,
    '', '### OpenAI',
  ];
  if (costs) {
    costs.sort((a, b) => b.usd - a.usd || String(a.apiKeyId).localeCompare(String(b.apiKeyId)));
    const total = costs.reduce((sum, row) => sum + row.usd, 0);
    if (!Number.isFinite(total)) throw new ReportError('OpenAI 비용 합계 오류');
    lines.push(`총 사용액: **${money(total)}**`, '', '**API 키별 비용**');
    if (costs.length === 0) lines.push('해당 구간에 기록된 비용 없음.');
    for (const row of costs) {
      const label = row.apiKeyId === null ? '키 미분류·공통 비용'
        : Object.hasOwn(keyNames, row.apiKeyId) ? keyNames[row.apiKeyId] : `미등록 키 (${row.apiKeyId})`;
      lines.push(`• ${escapeName(label)}: **${money(row.usd)}**`);
    }
  } else lines.push(`키별 비용: 확인 불가 — ${failure(ai)}`);
  lines.push(`[잔액은 OpenAI 결제 화면에서 확인](${BILLING_URL})`);
  lines.push('', '### OpenRouter');
  lines.push(balance.status === 'fulfilled' ? `남은 잔액: **${money(balance.value)}**` : `남은 잔액: 확인 불가 — ${failure(balance)}`);
  if (router.status === 'fulfilled') {
    lines.push(`총 사용액: **${money(router.value.reduce((sum, row) => sum + row.usd, 0))}**`, '', '**API 키별 비용**');
    if (router.value.length === 0) lines.push('해당 구간에 기록된 비용 없음.');
    for (const row of router.value) lines.push(`• ${escapeName(row.name)}: **${money(row.usd)}**`);
  } else lines.push(`키별 비용: 확인 불가 — ${failure(router)}`);
  lines.push('', '잔액은 조회 시점 기준. OpenRouter 비용은 크레딧 청구분이며, 비용은 지연 반영·조정될 수 있습니다.');
  const content = lines.join('\n');
  // 일부 키를 숨기거나 파일로 보내지 않고, 초과하면 명확한 실패로 처리한다.
  if (content.length > 2000) throw new ReportError('키별 보고가 Discord 본문 한도를 초과했습니다');
  return { date, content, complete: [ai, balance, router].every((result) => result.status === 'fulfilled') };
};

export const postReport = async ({ webhookUrl, report, fetchImpl = fetch }) => {
  let url;
  try { url = new URL(webhookUrl); } catch { throw new ReportError('Discord 웹훅 미설정 또는 형식 오류'); }
  if (url.origin !== 'https://discord.com' || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname) || url.username || url.password)
    throw new ReportError('Discord 웹훅 주소 형식 오류');
  url.search = '';
  url.searchParams.set('wait', 'true');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: report.content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!response.ok) throw new ReportError(`Discord 전송 실패: HTTP ${response.status}`);
  const receipt = await response.json();
  if (!/^\d+$/.test(receipt.id ?? '')) throw new ReportError('Discord 전송 영수증 확인 실패');
  return receipt.id;
};
