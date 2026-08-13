/**
 * Shared external-evidence match tiers (OOKLA / FCC).
 * Strong ≤ 2s, Near ≤ 5s, Unmatched > 5s.
 */

export const EVIDENCE_MATCH_TIERS = Object.freeze({
  STRONG_MAX_MS: 2000,
  NEAR_MAX_MS: 5000,
});

export function classifyEvidenceMatchTier(deltaMs) {
  const d = typeof deltaMs === "number" && Number.isFinite(deltaMs) ? Math.abs(deltaMs) : null;
  if (d === null) {
    return { tier: "unmatched", matched: false, deltaMs: null, label: "Unmatched" };
  }
  if (d <= EVIDENCE_MATCH_TIERS.STRONG_MAX_MS) {
    return { tier: "strong", matched: true, deltaMs: d, label: "Strong" };
  }
  if (d <= EVIDENCE_MATCH_TIERS.NEAR_MAX_MS) {
    return { tier: "near", matched: true, deltaMs: d, label: "Near" };
  }
  return { tier: "unmatched", matched: false, deltaMs: d, label: "Unmatched" };
}

export function isFreshOrRestoredGpsStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "fresh" || s === "restored";
}

export function gpsMatchConfidence({ tier, gpsStatus, source = "babydragon_session" } = {}) {
  if (!tier || tier === "unmatched") {
    return { confidence: "unmatched", status: "unmatched", source };
  }
  if (!isFreshOrRestoredGpsStatus(gpsStatus) && gpsStatus) {
    return { confidence: "rejected_stale_or_lost", status: "unmatched", source };
  }
  if (tier === "strong") return { confidence: "high", status: "matched_strong", source };
  return { confidence: "medium", status: "matched_near", source };
}

export default {
  EVIDENCE_MATCH_TIERS,
  classifyEvidenceMatchTier,
  isFreshOrRestoredGpsStatus,
  gpsMatchConfidence,
};
