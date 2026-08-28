/**
 * Validation funnel read path.
 *
 * The decision metric is a COHORT INTERSECTION, not a ratio of two
 * independent totals:
 *
 *   Qualified WTP = |completed ∩ purchase_intent_29| / |completed|
 *
 * Dividing all intents by all completions would count a visitor who scrolled
 * straight to pricing and never ran a case check, inflating the number that
 * decides whether this company gets built.
 */

import { isConfigured, pipeline, toCount } from "./redis.mjs";
import {
  ANSWER_FIELDS,
  CORE_FUNNEL,
  DIAGNOSTIC_EVENTS,
  QUALIFIED_ACTIONS,
  QUALIFIED_WTP_ACTION,
  SAMPLE_THRESHOLDS,
} from "./events.mjs";
import { keys } from "./store.mjs";
import { isUnattributed, parseCampaignKey } from "./attribution.mjs";
import { environmentInfo } from "./environment.mjs";

const COMPLETED = "case_check_completed";
const RECENT_SAMPLE = 100;

export function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Honest labelling beats false precision on a tiny sample. */
export function sampleQuality(completions) {
  if (completions >= SAMPLE_THRESHOLDS.decision)
    return { label: "decision", note: "Decision sample reached." };
  if (completions >= SAMPLE_THRESHOLDS.directional)
    return { label: "early", note: "Early signal — not yet decisive." };
  return {
    label: "directional",
    note: `Directional only — fewer than ${SAMPLE_THRESHOLDS.directional} completions.`,
  };
}

/** Ordered core stages with reach and stage-to-stage conversion. */
export function buildCoreFunnel({ unique = {}, totals = {}, sessions = 0 }) {
  let previous = null;
  return CORE_FUNNEL.map((name) => {
    const uniqueSessions = toCount(unique[name]);
    const step = {
      name,
      unique_sessions: uniqueSessions,
      total_events: toCount(totals[name]),
      reach_pct: rate(uniqueSessions, sessions),
      step_pct: previous === null ? null : rate(uniqueSessions, previous),
    };
    previous = uniqueSessions;
    return step;
  });
}

/**
 * Optional actions measured against completers only. `intersect` maps an
 * action to |completed ∩ action|.
 */
export function buildQualified({ completions = 0, intersect = {}, unique = {} }) {
  const actions = Object.fromEntries(
    QUALIFIED_ACTIONS.map((action) => {
      const sessions = toCount(intersect[action]);
      return [
        action,
        {
          sessions,
          pct: rate(sessions, completions),
          all_sessions: toCount(unique[action]),
        },
      ];
    }),
  );

  const qualifiedIntents = actions[QUALIFIED_WTP_ACTION].sessions;
  const allIntents = actions[QUALIFIED_WTP_ACTION].all_sessions;

  return {
    completions,
    actions,
    headline: {
      qualified_wtp_pct: rate(qualifiedIntents, completions),
      qualified_intents: qualifiedIntents,
      completions,
      // Visitors who signalled intent without running a case check. Real
      // interest, but explicitly outside the decision metric.
      unqualified_intents: Math.max(allIntents - qualifiedIntents, 0),
    },
    sample: sampleQuality(completions),
  };
}

/** Acquisition cohorts, always as unique sessions. */
export function buildCampaigns(rows) {
  return rows
    .map((row) => ({
      ...parseCampaignKey(row.key),
      key: row.key,
      unattributed: isUnattributed(row.key),
      sessions: toCount(row.sessions),
      case_starts: toCount(row.starts),
      completions: toCount(row.completions),
      qualified_intents: toCount(row.qualifiedIntents),
      completion_pct: rate(toCount(row.completions), toCount(row.sessions)),
      qualified_wtp_pct: rate(
        toCount(row.qualifiedIntents),
        toCount(row.completions),
      ),
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

function emptyResult(configured) {
  return {
    configured,
    environment: environmentInfo(),
    sessions: 0,
    core: buildCoreFunnel({}),
    ...buildQualified({}),
    campaigns: [],
    answers: {},
    recent: [],
  };
}

/** Read the whole dashboard in three pipelines. */
export async function readFunnel() {
  if (!isConfigured()) return emptyResult(false);

  const events = [...CORE_FUNNEL, ...DIAGNOSTIC_EVENTS];

  // Pass 1 — counts, cohort registry and answer registries.
  const base = await pipeline(
    [
      ...events.map((name) => ["SCARD", keys.unique(name)]),
      ...events.map((name) => ["GET", keys.count(name)]),
      ["SCARD", keys.sessions()],
      ["LRANGE", keys.recent(), 0, RECENT_SAMPLE - 1],
      ["SMEMBERS", keys.campaigns()],
      ...ANSWER_FIELDS.map((field) => ["SMEMBERS", keys.answerValues(field)]),
      // Exact cohort intersections — never approximated from raw counts.
      ...QUALIFIED_ACTIONS.map((action) => [
        "SINTERCARD",
        "2",
        keys.unique(COMPLETED),
        keys.unique(action),
      ]),
    ],
    { read: true },
  );

  let cursor = 0;
  const take = (n) => base.slice(cursor, (cursor += n));

  const uniqueValues = take(events.length);
  const totalValues = take(events.length);
  const [sessions] = take(1);
  const [recentRaw] = take(1);
  const [campaignKeys] = take(1);
  const answerRegistries = take(ANSWER_FIELDS.length);
  const intersectValues = take(QUALIFIED_ACTIONS.length);

  const unique = {};
  const totals = {};
  events.forEach((name, index) => {
    unique[name] = uniqueValues[index];
    totals[name] = totalValues[index];
  });

  const intersect = Object.fromEntries(
    QUALIFIED_ACTIONS.map((action, index) => [action, intersectValues[index]]),
  );

  // Pass 2 — per-cohort membership, and per-cohort qualified intent.
  const cohorts = Array.isArray(campaignKeys) ? campaignKeys : [];
  const campaignRows = [];
  if (cohorts.length) {
    const results = await pipeline(
      cohorts.flatMap((key) => [
        ["SCARD", keys.campaign(key, "page_view")],
        ["SCARD", keys.campaign(key, "case_check_started")],
        ["SCARD", keys.campaign(key, COMPLETED)],
        [
          "SINTERCARD",
          "2",
          keys.campaign(key, COMPLETED),
          keys.campaign(key, QUALIFIED_WTP_ACTION),
        ],
      ]),
      { read: true },
    );
    cohorts.forEach((key, index) => {
      const [sessionsCount, starts, completions, qualifiedIntents] =
        results.slice(index * 4, index * 4 + 4);
      campaignRows.push({
        key,
        sessions: sessionsCount,
        starts,
        completions,
        qualifiedIntents,
      });
    });
  }

  // Pass 3 — answer mix as unique sessions per value.
  const answers = {};
  const answerPairs = ANSWER_FIELDS.flatMap((field, index) =>
    (Array.isArray(answerRegistries[index]) ? answerRegistries[index] : []).map(
      (value) => ({ field, value }),
    ),
  );
  if (answerPairs.length) {
    const counts = await pipeline(
      answerPairs.map(({ field, value }) => [
        "SCARD",
        keys.answer(field, value),
      ]),
      { read: true },
    );
    answerPairs.forEach(({ field, value }, index) => {
      answers[field] = answers[field] || [];
      answers[field].push({ value, sessions: toCount(counts[index]) });
    });
    for (const field of Object.keys(answers)) {
      answers[field].sort((a, b) => b.sessions - a.sessions);
    }
  }

  const recent = (Array.isArray(recentRaw) ? recentRaw : [])
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    configured: true,
    environment: environmentInfo(),
    sessions: toCount(sessions),
    core: buildCoreFunnel({ unique, totals, sessions: toCount(sessions) }),
    ...buildQualified({
      completions: toCount(unique[COMPLETED]),
      intersect,
      unique,
    }),
    campaigns: buildCampaigns(campaignRows),
    answers,
    recent,
  };
}
