// 버셀 크론이 깃허브 워크플로를 깨울 때 쓰는 로직.
// 깃허브 자체 예약은 이 레포에서 두세 시간씩 밀려서, 시각은 버셀이 정하고 실행만 깃허브에 맡긴다
const WORKFLOW = 'metrics.yml';

// 월요일이면 주간까지 — 깃허브 예약 경로와 같은 규칙이다
export const modesForToday = (kstDate) =>
  new Date(`${kstDate}T00:00:00Z`).getUTCDay() === 1
    ? ['daily', 'weekly']
    : ['daily'];

export const dispatchWorkflow = async ({ repo, token, mode }) => {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { mode } }),
    },
  );
  // 성공은 204 No Content다
  if (!res.ok)
    throw new Error(
      `워크플로 실행 요청 실패(${mode}) ${res.status}: ${await res.text()}`,
    );
};
