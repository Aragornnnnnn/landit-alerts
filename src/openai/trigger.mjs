// Vercel 크론 요청을 검증하고 GitHub의 OpenAI 보고 워크플로를 실행한다.
import { timingSafeEqual } from 'node:crypto';

export const createCronHandler = ({ env = process.env, fetchImpl = fetch } = {}) => async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const expected = `Bearer ${env.CRON_SECRET ?? ''}`;
  const actual = req.headers.authorization;
  if (!env.CRON_SECRET || typeof actual !== 'string' || Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected)))
    return res.status(401).json({ error: 'unauthorized' });
  if (!env.GH_WORKFLOW_TOKEN) return res.status(503).json({ error: 'workflow_token_missing' });
  try {
    const response = await fetchImpl('https://api.github.com/repos/Aragornnnnnn/landit-alerts/actions/workflows/openai-report.yml/dispatches', {
      method: 'POST', headers: {
        Authorization: `Bearer ${env.GH_WORKFLOW_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }), signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (!response.ok) return res.status(502).json({ error: 'workflow_dispatch_failed' });
    return res.status(200).json({ dispatched: true });
  } catch { return res.status(502).json({ error: 'workflow_dispatch_failed' }); }
};
