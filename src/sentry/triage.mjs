// Sentry 카드를 올린 뒤 landit-triage에 분석을 요청한다 — 분석 결과는 그쪽이 카드의 스레드로 붙인다

// workflow_dispatch로 부른다. repository_dispatch는 토큰에 레포 쓰기 권한이 필요해서, 토큰이 새면 코드를 심을 수 있다
const TRIAGE_WORKFLOW_URL =
  'https://api.github.com/repos/Aragornnnnnn/landit-triage/actions/workflows/triage.yml/dispatches';
const ISSUE_URL_PATTERN = /\/issues\/(\d+)/;
const TIMEOUT_MS = 5000;

// 알림 payload에는 issue_id가 오지만, 없을 때를 위해 이벤트 링크에서도 찾는다
export const issueIdOf = (event) =>
  event.issue_id
    ? String(event.issue_id)
    : (event.web_url?.match(ISSUE_URL_PATTERN)?.[1] ?? null);

// inputs 이름은 landit-triage triage.yml의 workflow_dispatch inputs와 맞춘다. 값은 전부 문자열이어야 한다
export const buildTriageDispatch = (event, message) => {
  const issueId = issueIdOf(event);
  if (!issueId) return null;
  return {
    ref: 'main',
    inputs: {
      issue_id: issueId,
      event_id: event.event_id ?? '',
      channel_id: message.channel_id,
      message_id: message.id,
    },
  };
};

export const requestTriage = async (token, dispatch) => {
  const res = await fetch(TRIAGE_WORKFLOW_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'LanditAlerts/1.0',
    },
    body: JSON.stringify(dispatch),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok)
    throw new Error(`분석 요청 실패 ${res.status}: ${await res.text()}`);
};
