// HTTP 공용 헬퍼 — 실패 응답을 일관된 메시지로 던진다
export const assertOk = async (res, label) => {
  if (!res.ok)
    throw new Error(`${label} 실패 ${res.status}: ${await res.text()}`);
  return res;
};

export const fetchOk = async (url, ua = 'LanditAlerts/1.0') =>
  assertOk(await fetch(url, { headers: { 'User-Agent': ua } }), `요청(${url})`);
