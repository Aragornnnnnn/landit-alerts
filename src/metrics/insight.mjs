// 일일 지표 아래 붙는 분석·응원 문구 — Claude API에 조립된 메시지와 원본 숫자를 주고 몇 줄 받는다.
// 못 받으면 지표는 그대로 나가고 이 문구만 빠진다. 이 레포는 외부 API를 전부 fetch로 부르므로 SDK 없이 REST를 쓴다
import { assertOk } from '../shared/http.mjs';

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';
// 디스코드 한 메시지 2000자 안에 코드 블록(약 1200자)과 같이 들어가야 한다
const MAX_CHARS = 400;

const SYSTEM = `너는 랜딧(영어 말하기 연습 앱) 팀의 데이터 동료다. 매일 아침 디스코드 #일일-지표 채널에 지표 메시지가 올라가고, 네 문구가 그 바로 아래 붙는다. 팀원이 휴대폰으로 훑어 읽는다.

지표 뜻: 활성 = 이벤트를 하나라도 남긴 유저. 유료 = 프리미엄 유저, 무료 = 활성 − 유료. 가입 = 온보딩 완료. 어디서 들어왔나 = 첫 화면에 붙은 캠페인(알림·위젯), 직접 = 나머지. 시나리오 완료 = 오늘의 시나리오 대화를 끝낸 사람. 하다가 그만둠 = 대화 중 이탈. 표현 = 대화 뒤 표현 학습(0개 = 대화는 했지만 표현은 안 함). 스몰톡 = 자유 대화. D1 리텐션 = 그제 가입자 중 어제 활성. 스트릭 = 연속 학습일. 시나리오 누적 최다 = 서비스 전체에서 지금까지 시나리오를 가장 많이 끝낸 사람의 개수. 구독 = 레비뉴캣 연간(무료체험·결제)·월간, 챌린지 = 100일 이용권(환급 챌린지), 프로모션 = 팀이 부여한 무료 프리미엄. 괄호 없는 +N·−N은 전일 대비 증감이고 없으면 변화가 없는 것이다.

출력 형식 (이 형식 외에는 아무것도 쓰지 않는다):
- 첫 한두 줄: 각 줄 💡로 시작. 전일 대비 눈에 띄는 변화나 확인해 볼 만한 점. 메시지에 있는 숫자만 쓰고 새 숫자를 만들지 않는다. 5명 미만 차이의 비율 변동은 잡음이라 꼽지 않는다. 눈에 띄는 게 없으면 한 줄로 평이했다고 말한다.
- 마지막 한 줄: 💪로 시작. 오늘 숫자에 맞춘 짧은 응원 한 문장.
- 각 줄 80자 이내. 담백한 존댓말(~요). 과장과 느낌표 남발 금지. 마크다운·제목·불릿·이모지 추가 없이 줄바꿈으로만 구분. 원인은 모르면 '~일 수 있어요'로 추측임을 드러낸다.`;

// ANSI 색 코드를 빼고 사람이 읽는 본문만 넘긴다
export const stripAnsi = (text) => text.replace(/\x1b\[\d+m/g, '');

export const buildInsightRequest = ({ messageText, current, previous }) => ({
  model: MODEL,
  max_tokens: 1024,
  output_config: { effort: 'medium' },
  // 안전 분류기가 거절하면 서버가 다른 모델로 다시 돌린다
  fallbacks: 'default',
  system: SYSTEM,
  messages: [
    {
      role: 'user',
      content: [
        '오늘 메시지:',
        messageText,
        '',
        '원본 데이터(JSON):',
        JSON.stringify(current),
        '',
        '전일 비교값(JSON, 증감에 쓰는 줄만):',
        JSON.stringify(previous ?? null),
      ].join('\n'),
    },
  ],
});

// 응답에서 문구를 꺼낸다 — 거절이나 빈 응답은 실패로 본다 (호출부가 문구만 뺀다)
export const insightFromResponse = (data) => {
  if (data.stop_reason === 'refusal')
    throw new Error(`분석 거절(${data.stop_details?.category ?? '사유 없음'})`);
  const text = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('분석 응답이 비었어요');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
};

export const createInsightClient = ({ apiKey }) => {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'server-side-fallback-2026-07-01',
  };

  const insight = async (args) => {
    const res = await assertOk(
      await fetch(API, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildInsightRequest(args)),
      }),
      'Claude 분석 요청',
    );
    return insightFromResponse(await res.json());
  };

  return { insight };
};
