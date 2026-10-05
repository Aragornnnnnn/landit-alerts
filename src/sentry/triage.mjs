// Sentry 카드를 올린 뒤 landit-triage에 분석을 요청한다 — 분석 결과는 그쪽이 카드의 스레드로 붙인다

const TRIAGE_REPO = 'Aragornnnnnn/landit-triage';
const ISSUE_URL_PATTERN = /\/issues\/(\d+)/;

// 알림 payload에는 issue_id가 오지만, 없을 때를 위해 이벤트 링크에서도 찾는다
export const issueIdOf = (event) =>
  event.issue_id
    ? String(event.issue_id)
    : (event.web_url?.match(ISSUE_URL_PATTERN)?.[1] ?? null);

// 필드 이름은 landit-triage triage.yml의 client_payload와 맞춘다
export const buildTriageDispatch = (event, message) => {
  const issueId = issueIdOf(event);
  if (!issueId) return null;
  return {
    event_type: 'sentry-issue',
    client_payload: {
      issue_id: issueId,
      event_id: event.event_id ?? null,
      channel_id: message.channel_id,
      message_id: message.id,
    },
  };
};

export const requestTriage = async (token, dispatch) => {
  const res = await fetch(
    `https://api.github.com/repos/${TRIAGE_REPO}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'LanditAlerts/1.0',
      },
      body: JSON.stringify(dispatch),
    },
  );
  if (!res.ok)
    throw new Error(`분석 요청 실패 ${res.status}: ${await res.text()}`);
};
