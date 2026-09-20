// 지표 알림 순수 로직 — 전일 대비 증감 표기와 데일리 메시지 조립. 수집은 amplitude.mjs·revenuecat.mjs가 맡는다.
// 메시지는 ANSI 코드 블록 하나다. 증감을 초록·빨강으로 칠할 수 있는 유일한 디스코드 문법이라서다
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
// 블록 제목 줄이 전일 대비 이 비율 이상, 그리고 이 인원 이상 튀면 앞에 경고를 붙인다 (작은 숫자의 잡음은 거른다)
const SPIKE_RATIO = 0.5;
const SPIKE_MIN_DIFF = 5;

const ESC = '\x1b';
const ansi = (code, text) => `${ESC}[${code}m${text}${ESC}[0m`;
export const bold = (text) => ansi(1, text);
const green = (text) => ansi(32, text);
const red = (text) => ansi(31, text);

// " +9" 초록 / " −2" 빨강. 변화가 없거나 이전 값이 없으면 빈 문자열이라 첫 실행은 증감 없이 나간다
export const formatDelta = (current, previous) => {
  if (previous === undefined || previous === null) return '';
  const diff = current - previous;
  if (diff === 0) return '';
  return diff > 0 ? ` ${green(`+${diff}`)}` : ` ${red(`−${-diff}`)}`;
};

const isSpike = (current, previous) =>
  previous > 0 &&
  Math.abs(current - previous) >= SPIKE_MIN_DIFF &&
  Math.abs(current - previous) / previous >= SPIKE_RATIO;

const percent = (part, whole) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';

const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];

// "2026년 9월 19일 (토)"
const formatDate = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일 (${weekdayOf(iso)})`;
};
// 불릿 줄 — 들여쓰기 세 칸, 증감이 있으면 뒤에
const bullet = (text, current, previous) =>
  `   ${text}${formatDelta(current, previous)}`;

// 블록 제목 줄 — 굵게, 튀면 앞에 ⚠️
const headline = (text, current, previous) => {
  const body = `${bold(text)}${formatDelta(current, previous)}`;
  return isSpike(current, previous) ? `⚠️ ${body}` : body;
};

const total = (subscriptions) =>
  subscriptions.monthly +
  subscriptions.yearlyTrial +
  subscriptions.yearlyPaid +
  subscriptions.promo;

// 불릿 아래 한 단 더 들어간 줄 — 연간 안의 체험·결제처럼 부모 숫자를 쪼갠다
const subBullet = (text, current, previous) =>
  `      ${text}${formatDelta(current, previous)}`;

const yearly = (subs) => subs.yearlyTrial + subs.yearlyPaid;

// 구독 블록 불릿 — 연간은 체험 중과 결제 중으로 한 단 더 쪼갠다
const subscriptionLines = (subs, prevSubs) => [
  bullet(`월간 ${subs.monthly}명`, subs.monthly, prevSubs.monthly),
  bullet(
    `연간 ${yearly(subs)}명`,
    yearly(subs),
    prevSubs.yearlyTrial === undefined ? undefined : yearly(prevSubs),
  ),
  subBullet(
    `무료체험 중 ${subs.yearlyTrial}명`,
    subs.yearlyTrial,
    prevSubs.yearlyTrial,
  ),
  subBullet(
    `결제 중 ${subs.yearlyPaid}명`,
    subs.yearlyPaid,
    prevSubs.yearlyPaid,
  ),
  bullet(`프로모션 ${subs.promo}명`, subs.promo, prevSubs.promo),
];

export const wrapAnsi = (lines) => '```ansi\n' + lines.join('\n') + '\n```';

export const buildDailyMessage = (m, prev) => {
  const p = prev ?? {};
  const free = m.active.total - m.active.premium;
  const prevFree = p.active && p.active.total - p.active.premium;
  const direct = m.active.total - m.entries.notification - m.entries.widget;
  const completedFree = m.scenario.completed - m.scenario.completedPremium;
  const { expression, smalltalk } = m.premiumUsage;
  // 0개 = 유료로 시나리오는 끝냈지만 표현을 하나도 안 한 사람
  const expressionZero =
    m.scenario.completedPremium - expression.scenario.users;
  // 스몰톡은 판마다 표현 수가 달라 마지막 칸을 "N개 이상"으로 막는다. 0개 = 스몰톡은 했지만 표현을 안 한 사람
  const smalltalkExpressionZero = smalltalk.users - expression.smalltalk.users;
  const subs = m.subscriptions;
  const prevSubs = p.subscriptions ?? {};

  return wrapAnsi([
    bold(`📊 랜딧 데일리 · ${formatDate(m.date)}`),
    '',
    headline(`👥 활성 ${m.active.total}명`, m.active.total, p.active?.total),
    bullet(`유료 ${m.active.premium}명`, m.active.premium, p.active?.premium),
    bullet(`무료 ${free}명`, free, prevFree),
    '',
    headline(`🌱 가입 ${m.signups}명`, m.signups, p.signups),
    '',
    bold('🚪 어디서 들어왔나'),
    bullet(`알림 ${m.entries.notification}명`),
    bullet(`위젯 ${m.entries.widget}명`),
    bullet(`직접 ${direct}명`),
    '',
    headline(
      `🗣️ 시나리오 완료 ${m.scenario.completed}명`,
      m.scenario.completed,
      p.scenario?.completed,
    ) +
      ` · 활성의 ${percent(m.scenario.completed, m.active.total)} · 하다가 그만둠 ${m.scenario.abandoned}`,
    bullet(`유료 ${m.scenario.completedPremium}명`),
    bullet(`무료 ${completedFree}명`),
    '',
    bold(`💎 유료 ${m.active.premium}명이 쓴 것`),
    bullet(
      `시나리오 표현 ${expression.scenario.users}명 (${percent(expression.scenario.users, m.active.premium)}) · ` +
        [expressionZero, ...expression.scenario.byCount]
          .map((n, i) => `${i}개 ${n}명`)
          .join(' / '),
    ),
    bullet(
      `스몰톡 ${smalltalk.users}명 (${percent(smalltalk.users, m.active.premium)}) · ${smalltalk.count}판 · 한 판 평균 ${smalltalk.turnsAverage.toFixed(1)}턴`,
    ),
    bullet(
      `스몰톡 표현 ${expression.smalltalk.users}명 (${percent(expression.smalltalk.users, m.active.premium)}) · ` +
        [smalltalkExpressionZero, ...expression.smalltalk.byCount]
          .map((n, i, all) =>
            i === all.length - 1 ? `${i}개 이상 ${n}명` : `${i}개 ${n}명`,
          )
          .join(' / '),
    ),
    '',
    headline(
      `💳 구독 중 ${total(subs)}명`,
      total(subs),
      p.subscriptions && total(p.subscriptions),
    ),
    ...subscriptionLines(subs, prevSubs),
  ]);
};

const shortDate = (iso) => iso.split('-').slice(1).map(Number).join('/');
const formatRange = ({ start, end }) => `${shortDate(start)}~${shortDate(end)}`;

const addDays = (iso, offset) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// "9월 2주차" — 그 주의 목요일이 속한 달과 순서로 센다(ISO 방식). 달이 걸친 주도 한 달에만 속한다
export const weekOfMonth = (monday) => {
  const [, month, day] = addDays(monday, 3).split('-').map(Number);
  return `${month}월 ${Math.ceil(day / 7)}주차`;
};

// "9월 2주차 (9/7 월 00:00 ~ 9/13 일 23:59)" — 어느 시각까지 센 건지 드러낸다
const formatWeekRange = ({ start, end }) =>
  `${weekOfMonth(start)} (${shortDate(start)} ${weekdayOf(start)} 00:00 ~ ${shortDate(end)} ${weekdayOf(end)} 23:59)`;

// 리텐션 코호트는 지난주가 아니라 그 전주 가입자다 — D7이 차려면 일주일이 지나야 한다
const previousWeek = ({ start }) => ({
  start: addDays(start, -7),
  end: addDays(start, -1),
});

const average = (part, whole) =>
  whole > 0 ? (part / whole).toFixed(1) : '0.0';

// 190000 → "3분 10초", 40000 → "40초"
export const formatDuration = (ms) => {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}분 ${rest}초` : `${rest}초`;
};

// 완료 개수 분포 [1개 n, 2개 n, ...]에서 유저당 평균 개수
const averageFromDistribution = (byCount) => {
  const users = byCount.reduce((a, b) => a + b, 0);
  const total = byCount.reduce((sum, n, i) => sum + n * (i + 1), 0);
  return average(total, users);
};

export const buildWeeklyMessage = (m, prev) => {
  const p = prev ?? {};
  const free = m.active.total - m.active.premium;
  const prevFree = p.active && p.active.total - p.active.premium;
  const direct = m.active.total - m.entries.notification - m.entries.widget;
  const scenarioUsers = m.scenario.byCount.reduce((a, b) => a + b, 0);
  const seven = m.scenario.byCount[6];
  const { expression, smalltalk } = m.premiumUsage;
  const subs = m.subscriptions;
  const prevSubs = p.subscriptions ?? {};

  return wrapAnsi([
    bold(`📈 랜딧 위클리 · ${formatWeekRange(m.range)}`),
    '',
    headline(
      `👥 주간 활성 ${m.active.total}명`,
      m.active.total,
      p.active?.total,
    ),
    bullet(`유료 ${m.active.premium}명`, m.active.premium, p.active?.premium),
    bullet(`무료 ${free}명`, free, prevFree),
    '',
    headline(`🌱 가입 ${m.signups}명`, m.signups, p.signups),
    bullet(
      `온보딩 완료 ${percent(m.onboarding.completed, m.onboarding.started)}`,
    ),
    bullet(`첫 시나리오까지 ${percent(m.signupsWithScenario, m.signups)}`),
    '',
    bold('🚪 어디서 들어왔나'),
    bullet(`알림 ${m.entries.notification}명`),
    bullet(`위젯 ${m.entries.widget}명`),
    bullet(`직접 ${direct}명`),
    '',
    bold(
      `🗣️ 시나리오 완료 ${scenarioUsers}명 · 1인당 ${averageFromDistribution(m.scenario.byCount)}개`,
    ),
    bullet(m.scenario.byCount.map((n, i) => `${i + 1}개 ${n}명`).join(' · ')),
    bullet(
      `7개 완료 ${seven}명 · 유료 ${m.scenario.sevenPremium}명 / 무료 ${seven - m.scenario.sevenPremium}명`,
    ),
    '',
    bold(`💎 유료 ${m.active.premium}명이 일주일 동안 쓴 것`),
    bullet(
      `시나리오 표현 ${expression.scenario.users}명 (${percent(expression.scenario.users, m.active.premium)})`,
    ),
    subBullet(
      `1인당 ${average(expression.scenario.count, expression.scenario.users)}개`,
    ),
    subBullet(
      `시나리오 한 판당 ${average(expression.scenario.count, m.scenario.completedPremium)}개 / 4개`,
    ),
    bullet(
      `스몰톡 ${smalltalk.users}명 (${percent(smalltalk.users, m.active.premium)})`,
    ),
    subBullet(
      `1인당 ${average(smalltalk.count, smalltalk.users)}판 · 한 판 평균 ${smalltalk.turnsAverage.toFixed(1)}턴`,
    ),
    subBullet(
      `말한 시간 평균 ${formatDuration(smalltalk.speaking.average)} (최소 ${formatDuration(smalltalk.speaking.min)} · 최대 ${formatDuration(smalltalk.speaking.max)})`,
    ),
    bullet(
      `스몰톡 표현 ${expression.smalltalk.users}명 (${percent(expression.smalltalk.users, m.active.premium)})`,
    ),
    subBullet(
      `1인당 ${average(expression.smalltalk.count, expression.smalltalk.users)}개`,
    ),
    subBullet(
      `스몰톡 한 판당 ${average(expression.smalltalk.count, smalltalk.count)}개`,
    ),
    '',
    bold(
      `🔁 ${formatRange(previousWeek(m.range))} 가입 ${m.retention.cohort}명`,
    ),
    bullet(
      `하루 뒤 ${percent(m.retention.d1, m.retention.cohort)} · 일주일 뒤 ${percent(m.retention.d7, m.retention.cohort)} 남음`,
    ),
    '',
    headline(
      `💳 구독 중 ${total(subs)}명`,
      total(subs),
      p.subscriptions && total(p.subscriptions),
    ),
    ...subscriptionLines(subs, prevSubs),
  ]);
};
