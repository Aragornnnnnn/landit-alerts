// 지표 조립 — 수집기를 불러 lib.mjs가 받는 입력 모양을 만든다.
// 전일·전주 값은 저장하지 않고 같은 방식으로 다시 조회한다. 다만 비교에 쓰는 줄만 부른다(조회 비용이 배로 들지 않게)
import { WIDGET_CAMPAIGN, hasProp, propIsNot } from './amplitude.mjs';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const kstDate = (now = new Date()) =>
  new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

export const addDays = (iso, offset) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

export const yesterdayOf = (today) => addDays(today, -1);

// today가 속한 주의 직전 월~일
export const lastWeekOf = (today) => {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 일=0
  const thisMonday = addDays(today, -((weekday + 6) % 7));
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
};

export const compact = (iso) => iso.replaceAll('-', '');

const EVENT = {
  active: { event_type: '_active' },
  onboardingCompleted: { event_type: 'Onboarding Completed' },
  scenarioCompleted: { event_type: 'Scenario Talk Completed' },
  scenarioAbandoned: { event_type: 'Scenario Talk Abandoned' },
  smallTalkCompleted: { event_type: 'Small Talk Completed' },
  scenarioExpression: {
    event_type: 'Expression Completed',
    filters: [hasProp('scenario_id')],
  },
  smallTalkExpression: {
    event_type: 'Expression Completed',
    filters: [hasProp('session_id')],
  },
  // 알림 유입 = 캠페인이 붙었고 위젯이 아닌 첫 화면
  notificationEntry: {
    event_type: 'Page Viewed',
    filters: [propIsNot('entry_campaign', [WIDGET_CAMPAIGN])],
  },
};

const SCENARIO_EXPRESSION_MAX = 4;
const SMALLTALK_EXPRESSION_MAX = 3;

// 구독은 앰플리튜드와 출처가 갈려 있어, 못 가져와도 나머지 지표는 보낼 수 있다
const subscriptionsOrNull = async (revenuecat, date) => {
  try {
    return await revenuecat.subscriptions(date);
  } catch (error) {
    console.error(`구독 조회 실패 (${date}): ${error.message}`);
    return null;
  }
};

const retentionOf = async (amplitude, { cohortStart, cohortEnd, days }) => ({
  ...(await amplitude.retention({ cohortStart: compact(cohortStart), days })),
  start: cohortStart,
  end: cohortEnd,
});

export const collectDaily = async ({ amplitude, revenuecat }, date) => {
  const range = { start: compact(date), end: compact(date), days: 1 };
  const premium = { ...range, premium: true };
  const cohortStart = yesterdayOf(date);
  const [
    activeTotal,
    activePremium,
    signups,
    entryGroups,
    notificationEntries,
    scenarioCompleted,
    scenarioCompletedPremium,
    scenarioAbandoned,
    scenarioExpressionUsers,
    scenarioExpressionByCount,
    smallTalkExpressionUsers,
    smallTalkExpressionByCount,
    smallTalkUsers,
    smallTalkCount,
    smallTalkTurns,
    retention,
    subscriptions,
  ] = await Promise.all([
    amplitude.uniques(EVENT.active, range),
    amplitude.uniques(EVENT.active, premium),
    amplitude.uniques(EVENT.onboardingCompleted, range),
    amplitude.entries(range),
    amplitude.uniques(EVENT.notificationEntry, range),
    amplitude.uniques(EVENT.scenarioCompleted, range),
    amplitude.uniques(EVENT.scenarioCompleted, premium),
    amplitude.uniques(EVENT.scenarioAbandoned, range),
    amplitude.uniques(EVENT.scenarioExpression, premium),
    amplitude.frequency(EVENT.scenarioExpression, {
      ...premium,
      max: SCENARIO_EXPRESSION_MAX,
    }),
    amplitude.uniques(EVENT.smallTalkExpression, premium),
    amplitude.frequency(EVENT.smallTalkExpression, {
      ...premium,
      max: SMALLTALK_EXPRESSION_MAX,
    }),
    amplitude.uniques(EVENT.smallTalkCompleted, premium),
    amplitude.totals(EVENT.smallTalkCompleted, premium),
    amplitude.propStat(
      EVENT.smallTalkCompleted,
      'turn_count',
      'PROPAVG',
      premium,
    ),
    retentionOf(amplitude, { cohortStart, cohortEnd: cohortStart, days: 1 }),
    subscriptionsOrNull(revenuecat, date),
  ]);

  return {
    date,
    active: { total: activeTotal, premium: activePremium },
    signups,
    entries: {
      notification: notificationEntries,
      notificationByCampaign: entryGroups.notificationByCampaign,
      widget: entryGroups.widget,
    },
    scenario: {
      completed: scenarioCompleted,
      completedPremium: scenarioCompletedPremium,
      abandoned: scenarioAbandoned,
    },
    premiumUsage: {
      expression: {
        scenario: {
          users: scenarioExpressionUsers,
          byCount: scenarioExpressionByCount,
        },
        smalltalk: {
          users: smallTalkExpressionUsers,
          byCount: smallTalkExpressionByCount,
        },
      },
      smalltalk: {
        users: smallTalkUsers,
        count: smallTalkCount,
        turnsAverage: smallTalkTurns,
      },
    },
    retention,
    subscriptions,
  };
};

export const collectWeekly = async ({ amplitude, revenuecat }, week) => {
  const range = { start: compact(week.start), end: compact(week.end), days: 7 };
  const premium = { ...range, premium: true };
  const funnelRange = { start: range.start, end: range.end, windowDays: 7 };
  const cohort = lastWeekOf(week.start);
  const [
    activeTotal,
    activePremium,
    signups,
    onboarding,
    signupToScenario,
    entryGroups,
    notificationEntries,
    scenarioUsers,
    scenarioCount,
    scenarioBuckets,
    scenarioExpressionUsers,
    scenarioExpressionCount,
    smallTalkExpressionUsers,
    smallTalkExpressionCount,
    smallTalkUsers,
    smallTalkCount,
    smallTalkTurns,
    speakingAverage,
    speakingMin,
    speakingMax,
    retention,
    subscriptions,
  ] = await Promise.all([
    amplitude.uniques(EVENT.active, range),
    amplitude.uniques(EVENT.active, premium),
    amplitude.uniques(EVENT.onboardingCompleted, range),
    amplitude.funnel(
      ['Onboarding Started', 'Onboarding Completed'],
      funnelRange,
    ),
    amplitude.funnel(
      ['Onboarding Completed', 'Scenario Talk Completed'],
      funnelRange,
    ),
    amplitude.entries(range),
    amplitude.uniques(EVENT.notificationEntry, range),
    amplitude.uniques(EVENT.scenarioCompleted, range),
    amplitude.totals(EVENT.scenarioCompleted, range),
    amplitude.frequencyBuckets(EVENT.scenarioCompleted, range),
    amplitude.uniques(EVENT.scenarioExpression, premium),
    amplitude.totals(EVENT.scenarioExpression, premium),
    amplitude.uniques(EVENT.smallTalkExpression, premium),
    amplitude.totals(EVENT.smallTalkExpression, premium),
    amplitude.uniques(EVENT.smallTalkCompleted, premium),
    amplitude.totals(EVENT.smallTalkCompleted, premium),
    amplitude.propStat(
      EVENT.smallTalkCompleted,
      'turn_count',
      'PROPAVG',
      premium,
    ),
    amplitude.propStat(
      EVENT.smallTalkCompleted,
      'speaking_duration_ms',
      'PROPAVG',
      premium,
    ),
    amplitude.propStat(
      EVENT.smallTalkCompleted,
      'speaking_duration_ms',
      'PROPMIN',
      premium,
    ),
    amplitude.propStat(
      EVENT.smallTalkCompleted,
      'speaking_duration_ms',
      'PROPMAX',
      premium,
    ),
    retentionOf(amplitude, {
      cohortStart: cohort.start,
      cohortEnd: cohort.end,
      days: 7,
    }),
    subscriptionsOrNull(revenuecat, week.end),
  ]);

  return {
    range: week,
    active: { total: activeTotal, premium: activePremium },
    signups,
    onboarding: { started: onboarding[0], completed: onboarding[1] },
    signupsWithScenario: signupToScenario[1],
    entries: {
      notification: notificationEntries,
      notificationByCampaign: entryGroups.notificationByCampaign,
      widget: entryGroups.widget,
    },
    scenario: {
      users: scenarioUsers,
      count: scenarioCount,
      buckets: scenarioBuckets,
    },
    premiumUsage: {
      expression: {
        scenario: {
          users: scenarioExpressionUsers,
          count: scenarioExpressionCount,
        },
        smalltalk: {
          users: smallTalkExpressionUsers,
          count: smallTalkExpressionCount,
        },
      },
      smalltalk: {
        users: smallTalkUsers,
        count: smallTalkCount,
        turnsAverage: smallTalkTurns,
        speaking: {
          average: speakingAverage,
          min: speakingMin,
          max: speakingMax,
        },
      },
    },
    retention,
    subscriptions,
  };
};

// 증감에 쓰는 줄만 — 전일·전주는 이것만 부른다 (전체를 다시 부르면 조회 비용이 배가 된다)
export const collectDailyBaseline = async ({ amplitude, revenuecat }, date) => {
  const range = { start: compact(date), end: compact(date), days: 1 };
  const [total, premium, signups, completed, subscriptions] = await Promise.all(
    [
      amplitude.uniques(EVENT.active, range),
      amplitude.uniques(EVENT.active, { ...range, premium: true }),
      amplitude.uniques(EVENT.onboardingCompleted, range),
      amplitude.uniques(EVENT.scenarioCompleted, range),
      subscriptionsOrNull(revenuecat, date),
    ],
  );
  return {
    active: { total, premium },
    signups,
    scenario: { completed },
    subscriptions,
  };
};

export const collectWeeklyBaseline = async (
  { amplitude, revenuecat },
  week,
) => {
  const range = { start: compact(week.start), end: compact(week.end), days: 7 };
  const [total, premium, signups, subscriptions] = await Promise.all([
    amplitude.uniques(EVENT.active, range),
    amplitude.uniques(EVENT.active, { ...range, premium: true }),
    amplitude.uniques(EVENT.onboardingCompleted, range),
    subscriptionsOrNull(revenuecat, week.end),
  ]);
  return { active: { total, premium }, signups, subscriptions };
};
