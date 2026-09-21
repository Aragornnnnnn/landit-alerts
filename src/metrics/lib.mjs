// 지표 알림 순수 로직 — 증감 표기와 일일·주간 메시지 조립. 수집은 amplitude.mjs·revenuecat.mjs가 맡는다.
// 메시지는 ANSI 코드 블록 하나다. 증감을 초록·빨강으로 칠할 수 있는 유일한 디스코드 문법이라서다
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
// 블록 제목 줄이 전일 대비 이 비율 이상, 그리고 이 인원 이상 튀면 앞에 경고를 붙인다 (작은 숫자의 잡음은 거른다)
const SPIKE_RATIO = 0.5;
const SPIKE_MIN_DIFF = 5;

const ESC = '\x1b';
const ansi = (code, text) => `${ESC}[${code}m${text}${ESC}[0m`;
const bold = (text) => ansi(1, text);
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

const average = (part, whole) =>
  whole > 0 ? (part / whole).toFixed(1) : '0.0';

const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const shortDate = (iso) => iso.split('-').slice(1).map(Number).join('/');

// "2026년 9월 19일 (토)"
const formatDate = (iso) => {
  const [year, month, day] = iso.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일 (${weekdayOf(iso)})`;
};

// "9월 2주차" — 그 주의 목요일이 속한 달과 순서로 센다(ISO 방식). 달이 걸친 주도 한 달에만 속한다
export const weekOfMonth = (monday) => {
  const thursday = new Date(`${monday}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3);
  return `${thursday.getUTCMonth() + 1}월 ${Math.ceil(thursday.getUTCDate() / 7)}주차`;
};

// "9월 2주차 (9/7 월 00:00 ~ 9/13 일 23:59)" — 어느 시각까지 센 건지 드러낸다
const formatWeekRange = ({ start, end }) =>
  `${weekOfMonth(start)} (${shortDate(start)} ${weekdayOf(start)} 00:00 ~ ${shortDate(end)} ${weekdayOf(end)} 23:59)`;

// 190000 → "3분 10초", 40000 → "40초"
export const formatDuration = (ms) => {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}분 ${seconds % 60}초` : `${seconds}초`;
};

// 불릿 줄 — 들여쓰기 세 칸, 증감이 있으면 뒤에
const bullet = (text, current, previous) =>
  `   ${text}${formatDelta(current, previous)}`;

// 불릿 아래 한 단 더 들어간 줄 — 연간 안의 체험·결제처럼 부모 숫자를 쪼갠다
const subBullet = (text, current, previous) =>
  `      ${text}${formatDelta(current, previous)}`;

// 블록 제목 줄 — 굵게, 튀면 앞에 ⚠️
const headline = (text, current, previous) => {
  const body = `${bold(text)}${formatDelta(current, previous)}`;
  return isSpike(current, previous) ? `⚠️ ${body}` : body;
};

// "0개 3명 / 1개 2명 / … / 4개 이상 5명" — 마지막 칸은 그 이상을 다 담는다
const distribution = (zero, byCount) =>
  [zero, ...byCount]
    .map((n, i, all) =>
      i === all.length - 1 ? `${i}개 이상 ${n}명` : `${i}개 ${n}명`,
    )
    .join(' / ');

const wrapAnsi = (lines) => '```ansi\n' + lines.join('\n') + '\n```';

const total = (subs) =>
  subs.monthly + subs.yearlyTrial + subs.yearlyPaid + subs.promo;

const yearly = (subs) => subs.yearlyTrial + subs.yearlyPaid;

// 구독 블록 — 연간은 체험 중과 결제 중으로 한 단 더 쪼갠다.
// RevenueCat만 못 읽은 경우엔 나머지 지표를 살리고 이 자리만 비운다
const subscriptionLines = (subs, prevSubs) => {
  if (!subs) return [bold('💳 구독 정보를 못 가져왔어요')];
  const prev = prevSubs ?? {};
  return [
    headline(
      `💳 구독 중 ${total(subs)}명`,
      total(subs),
      prevSubs && total(prevSubs),
    ),
    bullet(`월간 ${subs.monthly}명`, subs.monthly, prev.monthly),
    bullet(
      `연간 ${yearly(subs)}명`,
      yearly(subs),
      prevSubs && yearly(prevSubs),
    ),
    subBullet(
      `무료체험 중 ${subs.yearlyTrial}명`,
      subs.yearlyTrial,
      prev.yearlyTrial,
    ),
    subBullet(`결제 중 ${subs.yearlyPaid}명`, subs.yearlyPaid, prev.yearlyPaid),
    bullet(`프로모션 ${subs.promo}명`, subs.promo, prev.promo),
  ];
};

export const buildDailyMessage = (m, prev) => {
  const p = prev ?? {};
  const free = m.active.total - m.active.premium;
  const prevFree = p.active && p.active.total - p.active.premium;
  const direct = m.active.total - m.entries.notification - m.entries.widget;
  const completedFree = m.scenario.completed - m.scenario.completedPremium;
  const { expression, smalltalk } = m.premiumUsage;
  // 0개 = 시나리오나 스몰톡은 했는데 표현을 하나도 안 한 사람.
  // 두 이벤트가 자정을 걸쳐 갈리면 음수가 나올 수 있어 0에서 막는다
  const scenarioZero = Math.max(
    0,
    m.scenario.completedPremium - expression.scenario.users,
  );
  const smalltalkZero = Math.max(
    0,
    smalltalk.users - expression.smalltalk.users,
  );

  return wrapAnsi([
    bold(`📊 랜딧 일일 지표 · ${formatDate(m.date)}`),
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
      ` · 활성의 ${percent(m.scenario.completed, m.active.total)} · 하다가 그만둠 ${m.scenario.abandoned}명`,
    bullet(`유료 ${m.scenario.completedPremium}명`),
    bullet(`무료 ${completedFree}명`),
    '',
    bold(`💎 유료 ${m.active.premium}명이 쓴 것`),
    bullet(
      `시나리오 표현 ${expression.scenario.users}명 (${percent(expression.scenario.users, m.active.premium)})`,
    ),
    subBullet(distribution(scenarioZero, expression.scenario.byCount)),
    bullet(
      `스몰톡 ${smalltalk.users}명 (${percent(smalltalk.users, m.active.premium)})`,
    ),
    subBullet(
      `${smalltalk.count}판 · 한 판 평균 ${smalltalk.turnsAverage.toFixed(1)}턴`,
    ),
    bullet(
      `스몰톡 표현 ${expression.smalltalk.users}명 (${percent(expression.smalltalk.users, m.active.premium)})`,
    ),
    subBullet(distribution(smalltalkZero, expression.smalltalk.byCount)),
    '',
    bold(
      `🔁 D1 리텐션 ${percent(m.retention.returned, m.retention.cohort)} · 그제 가입한 ${m.retention.cohort}명 중 어제도 온 사람 ${m.retention.returned}명`,
    ),
    '',
    ...subscriptionLines(m.subscriptions, p.subscriptions),
  ]);
};

// 알림 캠페인 이름 → 사람이 읽는 이름 (어휘는 landit-fe docs/analytics-utm.md). 모르는 캠페인은 이름 그대로
const CAMPAIGN_LABELS = {
  daily_scenario_reminder: '오늘의 시나리오',
  continue_expression: '표현 이어가기',
  small_talk_reminder: '스몰톡',
  mailbox_reply: '편지 답장',
  // 구 로컬 알림(LAN-406 제거 전 바이너리)이 아직 보내는 캠페인
  daily_reminder: '오늘의 시나리오 (구 알림)',
};

export const buildWeeklyMessage = (m, prev) => {
  const p = prev ?? {};
  const free = m.active.total - m.active.premium;
  const prevFree = p.active && p.active.total - p.active.premium;
  const direct = m.active.total - m.entries.notification - m.entries.widget;
  const { expression, smalltalk } = m.premiumUsage;

  return wrapAnsi([
    bold(`📈 랜딧 주간 지표 · ${formatWeekRange(m.range)}`),
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
    // 캠페인별 수는 겹쳐 들어온 사람이 있어 합이 위 숫자보다 클 수 있다
    ...Object.entries(m.entries.notificationByCampaign).map(([campaign, n]) =>
      subBullet(`${CAMPAIGN_LABELS[campaign] ?? campaign} ${n}명`),
    ),
    bullet(`위젯 ${m.entries.widget}명`),
    bullet(`직접 ${direct}명`),
    '',
    bold(
      `🗣️ 시나리오 완료 ${m.scenario.users}명 · 평균 ${average(m.scenario.count, m.scenario.users)}개`,
    ),
    bullet(
      m.scenario.buckets.map(([label, n]) => `${label} ${n}명`).join(' · '),
    ),
    '',
    bold(`💎 유료 ${m.active.premium}명이 일주일 동안 쓴 것`),
    bullet(
      `시나리오 표현 ${expression.scenario.users}명 (${percent(expression.scenario.users, m.active.premium)})`,
    ),
    subBullet(
      `평균 ${average(expression.scenario.count, expression.scenario.users)}개`,
    ),
    bullet(
      `스몰톡 ${smalltalk.users}명 (${percent(smalltalk.users, m.active.premium)})`,
    ),
    subBullet(
      `평균 ${average(smalltalk.count, smalltalk.users)}판 · 한 판 평균 ${smalltalk.turnsAverage.toFixed(1)}턴`,
    ),
    subBullet(
      `말한 시간 평균 ${formatDuration(smalltalk.speaking.average)} (최소 ${formatDuration(smalltalk.speaking.min)} · 최대 ${formatDuration(smalltalk.speaking.max)})`,
    ),
    bullet(
      `스몰톡 표현 ${expression.smalltalk.users}명 (${percent(expression.smalltalk.users, m.active.premium)})`,
    ),
    subBullet(
      `평균 ${average(expression.smalltalk.count, expression.smalltalk.users)}개`,
    ),
    '',
    bold(
      `🔁 주간 리텐션 ${percent(m.retention.returned, m.retention.cohort)} · ${shortDate(m.retention.start)}~${shortDate(m.retention.end)} 가입한 ${m.retention.cohort}명 중 지난주에 다시 온 사람 ${m.retention.returned}명`,
    ),
    '',
    ...subscriptionLines(m.subscriptions, p.subscriptions),
  ]);
};

// 조회가 실패해 지표를 못 만든 날 — 침묵하면 지표가 0인 건지 봇이 죽은 건지 모른다
export const buildFailureMessage = (label, reason) =>
  `⚠️ **${label} 지표를 못 가져왔어요**\n\`\`\`\n${reason}\n\`\`\``;
