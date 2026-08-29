/**
 * F10C2 CR1 — scenario-family applicability for acceptance.
 * Data-only runs do not fail overall because a voice rule exists on the profile.
 * Combined evaluation requires both evidence families AND an admin combined profile.
 */

import { VERDICTS, combineDirectionVerdicts } from "./verdicts.js";

export const SCENARIO_FAMILIES = Object.freeze({
  DATA: "data",
  VOICE: "voice",
  RF: "rf",
  COMBINED: "combined",
});

const DATA_ONLY = new Set([
  "native_http",
  "ftp",
  "iperf3",
  "ookla",
  "ookla_app",
  "fcc",
  "fcc_app",
]);

const VOICE_ONLY = new Set([
  "voice",
  "voice_mo",
  "voice_mt",
  "mo",
  "mt",
]);

const RF_ONLY = new Set([
  "rf_only",
  "rf_data",
  "rf",
]);

const COMBINED_TYPES = new Set([
  "combined",
  "unified_field_report",
  "voice_and_data",
  "data_and_voice",
]);

function cleanType(value) {
  return String(value || "").trim().toLowerCase();
}

function profileRequestsCombined(profile) {
  const p = profile || {};
  const kind = cleanType(p.kind || p.scenario_family || p.family);
  if (kind === "combined" || COMBINED_TYPES.has(kind)) return true;
  const rules = p.rules || {};
  if (rules.combined === true || cleanType(rules.family) === "combined") return true;
  const families = rules.families || rules.enabled_families || [];
  if (Array.isArray(families)) {
    const set = new Set(families.map((f) => cleanType(f)));
    if (set.has("data") && (set.has("voice") || set.has("mo") || set.has("mt"))) return true;
  }
  return false;
}

export function voiceDirectionsForScenario(scenarioType = "") {
  const type = cleanType(scenarioType);
  if (type === "voice_mo" || type === "mo") return ["MO"];
  if (type === "voice_mt" || type === "mt") return ["MT"];
  return ["MO", "MT"];
}

export function classifyScenarioFamily(scenarioType = "") {
  const type = cleanType(scenarioType);
  if (DATA_ONLY.has(type)) return SCENARIO_FAMILIES.DATA;
  if (VOICE_ONLY.has(type)) return SCENARIO_FAMILIES.VOICE;
  if (RF_ONLY.has(type)) return SCENARIO_FAMILIES.RF;
  if (COMBINED_TYPES.has(type)) return SCENARIO_FAMILIES.COMBINED;
  return SCENARIO_FAMILIES.DATA;
}

export function hasDataEvidence(iterations = []) {
  return (iterations || []).some((row) => {
    if (!row || typeof row !== "object") return false;
    if (row.dl_mbps != null || row.ul_mbps != null || row.dlMbps != null || row.ulMbps != null) return true;
    const kind = cleanType(row.scenario_kind || row.scenario_type);
    return DATA_ONLY.has(kind);
  });
}

export function hasVoiceEvidence(callEvents = []) {
  return Array.isArray(callEvents) && callEvents.length > 0;
}

/**
 * @returns {{
 *   family: string,
 *   evaluate_data: boolean,
 *   evaluate_voice: boolean,
 *   excluded: string[],
 *   combined: boolean,
 *   reason: string,
 * }}
 */
export function resolveScenarioApplicability({
  scenarioType = "",
  iterations = [],
  callEvents = [],
  profile = null,
} = {}) {
  const family = classifyScenarioFamily(scenarioType);
  const adminCombined = profileRequestsCombined(profile);
  const dataEvidence = hasDataEvidence(iterations) || family === SCENARIO_FAMILIES.DATA || family === SCENARIO_FAMILIES.COMBINED;
  const bothFamilies = (hasDataEvidence(iterations) || family === SCENARIO_FAMILIES.DATA)
    && hasVoiceEvidence(callEvents);

  if (family === SCENARIO_FAMILIES.RF && !adminCombined) {
    return {
      family,
      evaluate_data: false,
      evaluate_voice: false,
      excluded: ["dl_ul", "mo_mt"],
      combined: false,
      reason: "rf_only_not_configured_for_data_or_voice",
    };
  }

  if (family === SCENARIO_FAMILIES.VOICE) {
    return {
      family,
      evaluate_data: false,
      evaluate_voice: true,
      excluded: ["dl_ul"],
      combined: false,
      reason: "voice_only",
    };
  }

  if (family === SCENARIO_FAMILIES.DATA) {
    const combined = adminCombined && bothFamilies;
    return {
      family,
      evaluate_data: true,
      evaluate_voice: combined,
      excluded: combined ? [] : ["mo_mt"],
      combined,
      reason: combined ? "admin_combined_with_both_families" : "data_only_voice_not_applicable",
    };
  }

  if (family === SCENARIO_FAMILIES.COMBINED || adminCombined) {
    if (adminCombined && bothFamilies) {
      return {
        family: SCENARIO_FAMILIES.COMBINED,
        evaluate_data: true,
        evaluate_voice: true,
        excluded: [],
        combined: true,
        reason: "combined_profile_and_both_evidence_families",
      };
    }
    return {
      family: family === SCENARIO_FAMILIES.COMBINED ? family : SCENARIO_FAMILIES.DATA,
      evaluate_data: dataEvidence,
      evaluate_voice: false,
      excluded: ["mo_mt"],
      combined: false,
      reason: "combined_requires_admin_profile_and_both_families",
    };
  }

  return {
    family,
    evaluate_data: true,
    evaluate_voice: false,
    excluded: ["mo_mt"],
    combined: false,
    reason: "default_data_only",
  };
}

/**
 * Presentation overlay for an immutable server snapshot.
 * Does not rewrite stored snapshot rows. Excludes inapplicable voice from overall.
 */
export function displayAcceptanceFromSnapshot({
  snapshot = null,
  scenarioType = "",
  iterations = [],
  callEvents = [],
  profile = null,
} = {}) {
  if (!snapshot) return null;
  const applicability = resolveScenarioApplicability({
    scenarioType,
    iterations,
    callEvents,
    profile,
  });
  const rules = {
    ...(snapshot.resolved_rules || {}),
    excluded_rules: applicability.excluded,
    applicability,
  };
  if (applicability.evaluate_voice) {
    return {
      ...snapshot,
      server_snapshot_retained: true,
      resolved_rules: rules,
    };
  }
  const overall = applicability.evaluate_data
    ? combineDirectionVerdicts(
      [snapshot.dl_verdict, snapshot.ul_verdict].filter((v) => v && v !== VERDICTS.NA),
      "AND",
    )
    : VERDICTS.NOT_EVALUATED;
  return {
    ...snapshot,
    server_snapshot_retained: true,
    server_overall_verdict: snapshot.overall_verdict,
    overall_verdict: overall,
    mo_verdict: VERDICTS.NA,
    mt_verdict: VERDICTS.NA,
    resolved_rules: rules,
  };
}

export default {
  SCENARIO_FAMILIES,
  classifyScenarioFamily,
  hasDataEvidence,
  hasVoiceEvidence,
  resolveScenarioApplicability,
  displayAcceptanceFromSnapshot,
  voiceDirectionsForScenario,
};
