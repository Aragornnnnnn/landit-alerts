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

// 메시지 하나가 코드 블록 하나. 그 뒤에 코드 블록 밖 일반 텍스트(분석·응원)가 붙을 수 있다
const wrapAnsi = (lines, trailing) =>
  '```ansi\n' + lines.join('\n') + '\n```' + (trailing ? `\n${trailing}` : '');

// 구독·챌린지를 합친 유료 인원. 챌린지(100일 이용권)는 앰플리튜드에서 따로 와서 구독이 없어도 더한다
const total = (subs, challenge) =>
  (subs ? subs.monthly + subs.yearlyTrial + subs.yearlyPaid + subs.promo : 0) +
  challenge;

const yearly = (subs) => subs.yearlyTrial + subs.yearlyPaid;

// 구독 블록 — 연간(체험·결제·해지예정) / 월간 / 챌린지 / 프로모션.
// RevenueCat만 못 읽은 경우엔 나머지 지표를 살리고 구독 줄만 비운다. 챌린지는 출처가 달라 그대로 남는다
const subscriptionLines = (subs, prevSubs, challenge, prevChallenge) => {
  const prev = prevSubs ?? {};
  const challengeLine = bullet(
    `챌린지 ${challenge}명`,
    challenge,
    prevChallenge,
  );
  if (!subs) return [bold('💳 구독 정보를 못 가져왔어요'), challengeLine];
  return [
    headline(
      `💳 구독·챌린지 ${total(subs, challenge)}명`,
      total(subs, challenge),
      prevSubs && total(prevSubs, prevChallenge ?? 0),
    ),
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
    // 바로 위 숫자에 이미 들어 있는 사람들이다 — 더하는 줄이 아니라 그중 얼마인지를 말한다
    subBullet(
      `이 중 해지예정 ${subs.canceling}명`,
      subs.canceling,
      prev.canceling,
    ),
    bullet(`월간 ${subs.monthly}명`, subs.monthly, prev.monthly),
    challengeLine,
    bullet(`프로모션 ${subs.promo}명`, subs.promo, prev.promo),
  ];
};

// 스트릭 줄 — 슈퍼베이스에서 온다. 못 읽으면 그 줄만 비운다
const streakLine = (streak) => {
  if (!streak) return bold('🔥 스트릭 정보를 못 가져왔어요');
  if (!streak.top) return bold('🔥 최고 스트릭 0일 · 이어가는 사람이 없어요');
  return bold(
    `🔥 최고 스트릭 ${streak.top}일 · ${streak.users}명이 이어가는 중`,
  );
};

// 알림 캠페인 이름 → 사람이 읽는 이름 (어휘는 landit-fe docs/analytics-utm.md). 모르는 캠페인은 이름 그대로
const CAMPAIGN_LABELS = {
  daily_scenario_reminder: '오늘의 시나리오',
  continue_expression: '표현 이어가기',
  small_talk_reminder: '스몰톡',
  mailbox_reply: '편지 답장',
  expression_review: '복습 퀴즈',
  // 구 로컬 알림(LAN-406 제거 전 바이너리)이 아직 보내는 캠페인
  daily_reminder: '오늘의 시나리오 (구 알림)',
};

// 어드민이 손으로 보낸 공지는 캠페인 이름에 문구가 그대로 들어 있다 — 밑줄만 풀어 읽히게 한다
export const campaignLabel = (campaign) =>
  CAMPAIGN_LABELS[campaign] ??
  (campaign.startsWith('admin_')
    ? campaign.slice('admin_'.length).replaceAll('_', ' ')
    : campaign);

// 유입 블록 — 알림 아래에 캠페인별로 한 단 더 쪼갠다. 알람은 잠금화면 알람의 「대화하러 가기」.
// 캠페인별 수는 겹쳐 들어온 사람이 있어 합이 알림 인원보다 클 수 있다
const entryLines = (entries, direct) => [
  bold('🚪 어디서 들어왔나'),
  bullet(`알림 ${entries.notification}명`),
  ...Object.entries(entries.notificationByCampaign).map(([campaign, n]) =>
    subBullet(`${campaignLabel(campaign)} ${n}명`),
  ),
  bullet(`위젯 ${entries.widget}명`),
  bullet(`알람 ${entries.alarm}명`),
  bullet(`직접 ${direct}명`),
];

// 직접 = 활성 중 캠페인 없이 들어온 사람
const directOf = (m) =>
  m.active.total - m.entries.notification - m.entries.widget - m.entries.alarm;

// insight는 Claude가 쓴 분석·응원 문구(일반 텍스트). 없으면 코드 블록만 나간다
export const buildDailyMessage = (m, prev, insight) => {
  const p = prev ?? {};
  const free = m.active.total - m.active.premium;
  const prevFree = p.active && p.active.total - p.active.premium;
  const direct = directOf(m);
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

  return wrapAnsi(
    [
      bold(`📊 랜딧 일일 지표 · ${formatDate(m.date)}`),
      '',
      headline(`👥 활성 ${m.active.total}명`, m.active.total, p.active?.total),
      bullet(`유료 ${m.active.premium}명`, m.active.premium, p.active?.premium),
      bullet(`무료 ${free}명`, free, prevFree),
      '',
      headline(`🌱 가입 ${m.signups}명`, m.signups, p.signups),
      '',
      ...entryLines(m.entries, direct),
      '',
      headline(
        `🗣️ 시나리오 완료 ${m.scenario.completed}명`,
        m.scenario.completed,
        p.scenario?.completed,
      ) +
        ` · 활성의 ${percent(m.scenario.completed, m.active.total)} · 하다가 그만둠 ${m.scenario.abandoned}명`,
      bullet(`유료 ${m.scenario.completedPremium}명`),
      bullet(`무료 ${completedFree}명`),
      bullet(`가장 많이 한 사람 ${m.scenario.max}개`),
      '',
      bold(`💎 유료 ${m.active.premium}명이 쓴 것`),
      bullet(
        `시나리오 표현 ${expression.scenario.users}명 (${percent(expression.scenario.users, m.active.premium)})`,
      ),
      subBullet(distribution(scenarioZero, expression.scenario.byCount)),
      bullet(
        `스몰톡 ${smalltalk.users}명 (${percent(smalltalk.users, m.active.premium)}) · ${smalltalk.count}판 · 한 판 평균 ${smalltalk.turnsAverage.toFixed(1)}턴`,
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
      streakLine(m.streak),
      '',
      ...subscriptionLines(
        m.subscriptions,
        p.subscriptions,
        m.challenge,
        p.challenge,
      ),
    ],
    insight,
  );
};

export const buildWeeklyMessage = (m, prev) => {
  const p = prev ?? {};
  const free = m.active.total - m.active.premium;
  const prevFree = p.active && p.active.total - p.active.premium;
  const direct = directOf(m);
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
    ...entryLines(m.entries, direct),
    '',
    bold(
      `🗣️ 시나리오 완료 ${m.scenario.users}명 · 평균 ${average(m.scenario.count, m.scenario.users)}개 · 가장 많이 한 사람 ${m.scenario.max}개`,
    ),
    bullet(
      m.scenario.buckets.map(([label, n]) => `${label} ${n}명`).join(' · '),
    ),
    '',
    bold(`💎 유료 ${m.active.premium}명이 일주일 동안 쓴 것`),
    // 항목마다 한 줄 — 휴대폰에서 훑어 읽게
    bullet(
      `시나리오 표현 ${expression.scenario.users}명 (${percent(expression.scenario.users, m.active.premium)}) · 평균 ${average(expression.scenario.count, expression.scenario.users)}개`,
    ),
    bullet(
      `스몰톡 ${smalltalk.users}명 (${percent(smalltalk.users, m.active.premium)}) · 평균 ${average(smalltalk.count, smalltalk.users)}판 · 한 판 ${smalltalk.turnsAverage.toFixed(1)}턴 · 말한 시간 ${formatDuration(smalltalk.speaking.average)} (${formatDuration(smalltalk.speaking.min)}~${formatDuration(smalltalk.speaking.max)})`,
    ),
    bullet(
      `스몰톡 표현 ${expression.smalltalk.users}명 (${percent(expression.smalltalk.users, m.active.premium)}) · 평균 ${average(expression.smalltalk.count, expression.smalltalk.users)}개`,
    ),
    '',
    bold(
      `🔁 주간 리텐션 ${percent(m.retention.returned, m.retention.cohort)} · ${shortDate(m.retention.start)}~${shortDate(m.retention.end)} 가입한 ${m.retention.cohort}명 중 지난주에 다시 온 사람 ${m.retention.returned}명`,
    ),
    '',
    streakLine(m.streak),
    '',
    ...subscriptionLines(
      m.subscriptions,
      p.subscriptions,
      m.challenge,
      p.challenge,
    ),
  ]);
};

// 조회가 실패해 지표를 못 만든 날 — 침묵하면 지표가 0인 건지 봇이 죽은 건지 모른다
export const buildFailureMessage = (label, reason) =>
  `⚠️ **${label} 지표를 못 가져왔어요**\n\`\`\`\n${reason}\n\`\`\``;
