// 버셀 크론 수신 엔드포인트 — 깃허브 지표 워크플로를 깨운다.
// 일하는 곳은 그대로 깃허브 Actions다. 버셀은 "지금 돌려"라는 요청만 보낸다
import { kstDate } from '../src/metrics/collect.mjs';
import { dispatchWorkflow, modesForToday } from '../src/metrics/trigger.mjs';

const REPO = 'Aragornnnnnn/landit-alerts';

// 버셀 크론은 CRON_SECRET을 Bearer로 보낸다 — 아무나 이 주소를 눌러 알림을 쏘지 못하게 막는다
const isFromVercelCron = (req) =>
  Boolean(process.env.CRON_SECRET) &&
  req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

export default async (req, res) => {
  if (!isFromVercelCron(req))
    return res.status(401).json({ error: 'unauthorized' });

  const token = process.env.GH_WORKFLOW_TOKEN;
  if (!token) return res.status(500).json({ error: 'GH_WORKFLOW_TOKEN 없음' });

  const modes = modesForToday(kstDate());
  for (const mode of modes) await dispatchWorkflow({ repo: REPO, token, mode });
  return res.status(200).json({ dispatched: modes });
};
