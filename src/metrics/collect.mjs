// 지표 조립 — 앰플리튜드·RevenueCat 수집기를 불러 lib.mjs가 받는 입력 모양을 만든다.
// 전일·전주 값은 저장하지 않고 같은 방식으로 다시 조회한다 (둘 다 과거를 그대로 돌려주므로 상태 파일이 필요 없다)
import { hasProp } from './amplitude.mjs';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const kstDate = (now = new Date()) =>
  new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

const addDays = (iso, offset) => {
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
    filters: [
      {
        subprop_type: 'event',
        subprop_key: 'entry_campaign',
        subprop_op: 'is not',
        subprop_value: ['(none)', 'streak_widget'],
      },
    ],
  },
};

const SCENARIO_EXPRESSION_MAX = 4;
const SMALLTALK_EXPRESSION_MAX = 3;

export const collectDaily = async ({ amplitude, extras, revenuecat }, date) => {
  const range = { start: compact(date), end: compact(date), days: 1 };
  const premium = { ...range, premium: true };
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
    extras.retention({ cohortStart: compact(yesterdayOf(date)), days: 1 }),
    revenuecat.subscriptions(date),
  ]);

  return {
    date,
    active: { total: activeTotal, premium: activePremium },
    signups,
    entries: { notification: notificationEntries, widget: entryGroups.widget },
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

export const collectWeekly = async (
  { amplitude, extras, revenuecat },
  week,
) => {
  const range = { start: compact(week.start), end: compact(week.end), days: 7 };
  const premium = { ...range, premium: true };
  const funnelRange = { start: range.start, end: range.end, windowDays: 7 };
  const [
    activeTotal,
    activePremium,
    signups,
    onboarding,
    signupToScenario,
    entryGroups,
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
    extras.funnel(['Onboarding Started', 'Onboarding Completed'], funnelRange),
    extras.funnel(
      ['Onboarding Completed', 'Scenario Talk Completed'],
      funnelRange,
    ),
    amplitude.entries(range),
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
    extras.retention({
      cohortStart: compact(addDays(week.start, -7)),
      days: 7,
    }),
    revenuecat.subscriptions(week.end),
  ]);

  return {
    range: week,
    active: { total: activeTotal, premium: activePremium },
    signups,
    onboarding: { started: onboarding[0], completed: onboarding[1] },
    signupsWithScenario: signupToScenario[1],
    entries: {
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
