/**
 * Safe RF configuration helpers for Excel Plot Report.
 * Band from EARFCN is labeled Derived. CA is Never inferred from NSA alone.
 */

function getNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 3GPP TS 36.101 Table 5.7.3-1 (partial common bands). Derived only. */
export function deriveLteBandFromEarfcn(earfcn) {
  const n = getNumber(earfcn);
  if (n === null) return null;
  const ranges = [
    { band: 1, low: 0, high: 599 },
    { band: 2, low: 600, high: 1199 },
    { band: 3, low: 1200, high: 1949 },
    { band: 4, low: 1950, high: 2399 },
    { band: 5, low: 2400, high: 2649 },
    { band: 7, low: 2750, high: 3449 },
    { band: 8, low: 3450, high: 3799 },
    { band: 12, low: 5010, high: 5179 },
    { band: 13, low: 5180, high: 5279 },
    { band: 14, low: 5280, high: 5379 },
    { band: 17, low: 5730, high: 5849 },
    { band: 18, low: 5850, high: 5999 },
    { band: 19, low: 6000, high: 6149 },
    { band: 20, low: 6150, high: 6449 },
    { band: 25, low: 8040, high: 8689 },
    { band: 26, low: 8690, high: 9039 },
    { band: 28, low: 9210, high: 9659 },
    { band: 38, low: 37750, high: 38249 },
    { band: 40, low: 38650, high: 39649 },
    { band: 41, low: 39650, high: 41589 },
    { band: 66, low: 66436, high: 67335 },
    { band: 71, low: 68586, high: 68935 },
  ];
  const hit = ranges.find((r) => n >= r.low && n <= r.high);
  return hit ? hit.band : null;
}

export function formatBandwidthMhz(rawKhzOrMhz, unitHint = null) {
  const n = getNumber(rawKhzOrMhz);
  if (n === null) return null;
  // Android LTE bandwidth often in kHz (e.g. 20000 = 20 MHz)
  if (unitHint === "khz" || n >= 1000) {
    return Number((n / 1000).toFixed(2));
  }
  return Number(n.toFixed(2));
}

/**
 * Build RF configuration rows from raw plot/export rows.
 * CA Status is Not exposed unless a direct source exists on the sample.
 */
export function buildRfConfigurationRows(rawRows = []) {
  const active = (rawRows || []).filter((r) => String(r.record_state || "") !== "paused");
  const byKey = new Map();

  const upsert = (key, patch) => {
    const prev = byKey.get(key) || {
      technology: patch.technology,
      serving_role: patch.serving_role,
      band: null,
      channel: null,
      bandwidth_dl: null,
      bandwidth_ul: null,
      pci_psc_bsic: null,
      cell_id_nci: null,
      tac_lac: null,
      ca_status: "Not exposed",
      first_observed: null,
      last_observed: null,
      source_truth_note: patch.source_truth_note || "Direct Android CellIdentity",
      _elapsedFirst: null,
      _elapsedLast: null,
    };
    Object.keys(patch).forEach((k) => {
      if (k.startsWith("_")) return;
      if (patch[k] !== null && patch[k] !== undefined && patch[k] !== "" && prev[k] == null) {
        prev[k] = patch[k];
      }
    });
    const elapsed = getNumber(patch._elapsed);
    if (elapsed !== null) {
      if (prev._elapsedFirst === null || elapsed < prev._elapsedFirst) {
        prev._elapsedFirst = elapsed;
        prev.first_observed = patch.first_observed || elapsed;
      }
      if (prev._elapsedLast === null || elapsed > prev._elapsedLast) {
        prev._elapsedLast = elapsed;
        prev.last_observed = patch.last_observed || elapsed;
      }
    }
    byKey.set(key, prev);
  };

  active.forEach((row) => {
    const elapsed = getNumber(row.elapsed_sec);
    const ltePci = getNumber(row.lte_pci);
    const lteEarfcn = getNumber(row.lte_earfcn);
    if (ltePci !== null || lteEarfcn !== null || getNumber(row.lte_rsrp) !== null) {
      const bandDirect = getNumber(row.lte_band);
      const bandDerived = bandDirect === null ? deriveLteBandFromEarfcn(lteEarfcn) : null;
      const bw = formatBandwidthMhz(row.lte_bandwidth_khz ?? row.lte_bandwidth, row.lte_bandwidth_khz != null ? "khz" : null);
      upsert(`LTE|${lteEarfcn ?? "x"}|${ltePci ?? "x"}`, {
        technology: "LTE",
        serving_role: "Serving / anchor",
        band: bandDirect ?? bandDerived,
        channel: lteEarfcn,
        bandwidth_dl: bw,
        pci_psc_bsic: ltePci,
        cell_id_nci: getNumber(row.lte_cell_id),
        tac_lac: getNumber(row.lte_tac),
        ca_status: row.lte_ca_status || "Not exposed",
        source_truth_note: bandDirect !== null
          ? "Direct Android band field"
          : (bandDerived !== null ? "Safely derived from EARFCN" : "Direct Android CellIdentity"),
        _elapsed: elapsed,
        first_observed: elapsed,
        last_observed: elapsed,
      });
    }

    const nrPci = getNumber(row.nr_pci);
    const nrArfcn = getNumber(row.nr_nrarfcn);
    if (nrPci !== null || nrArfcn !== null || getNumber(row.nr_ss_rsrp) !== null) {
      const bandDirect = getNumber(row.nr_band);
      upsert(`NR|${nrArfcn ?? "x"}|${nrPci ?? "x"}`, {
        technology: "NR",
        serving_role: (() => {
          const hasLte = getNumber(row.lte_pci) !== null || getNumber(row.lte_earfcn) !== null || getNumber(row.lte_rsrp) !== null;
          const nrStatus = String(row.nr_secondary_status || "").toLowerCase();
          const measurementOnly = nrStatus.includes("measurement");
          if (hasLte && nrStatus.includes("live") && !measurementOnly) return "NR Secondary / NSA";
          if (hasLte && measurementOnly) return "NR Measurement under LTE anchor";
          if (!hasLte && (getNumber(row.nr_ss_rsrp) !== null || getNumber(row.nr_pci) !== null)) {
            return "NR Serving / SA context";
          }
          return "NR context";
        })(),
        band: bandDirect,
        channel: nrArfcn,
        bandwidth_dl: formatBandwidthMhz(row.nr_bandwidth_khz ?? row.nr_bandwidth, row.nr_bandwidth_khz != null ? "khz" : null),
        pci_psc_bsic: nrPci,
        cell_id_nci: getNumber(row.nr_nci),
        tac_lac: getNumber(row.nr_tac),
        ca_status: row.nr_ca_status || "Not exposed",
        source_truth_note: bandDirect !== null
          ? "Direct Android NR band field"
          : "Direct Android CellIdentityNr (bandwidth/CA not exposed unless PhysicalChannelConfig available)",
        _elapsed: elapsed,
        first_observed: elapsed,
        last_observed: elapsed,
      });
    }

    const psc = getNumber(row.wcdma_psc);
    const uarfcn = getNumber(row.wcdma_uarfcn);
    if (psc !== null || uarfcn !== null || getNumber(row.wcdma_rscp) !== null) {
      upsert(`WCDMA|${uarfcn ?? "x"}|${psc ?? "x"}`, {
        technology: "WCDMA",
        serving_role: "Serving",
        band: getNumber(row.wcdma_band),
        channel: uarfcn,
        pci_psc_bsic: psc,
        cell_id_nci: getNumber(row.wcdma_cell_id),
        tac_lac: getNumber(row.wcdma_lac),
        ca_status: "Not exposed",
        source_truth_note: "Direct Android CellIdentityWcdma",
        _elapsed: elapsed,
        first_observed: elapsed,
        last_observed: elapsed,
      });
    }

    const bsic = getNumber(row.gsm_bsic);
    const arfcn = getNumber(row.gsm_arfcn);
    if (bsic !== null || arfcn !== null || getNumber(row.gsm_rxlev) !== null) {
      upsert(`GSM|${arfcn ?? "x"}|${bsic ?? "x"}`, {
        technology: "GSM",
        serving_role: "Serving",
        band: getNumber(row.gsm_band),
        channel: arfcn,
        pci_psc_bsic: bsic,
        cell_id_nci: getNumber(row.gsm_cell_id),
        tac_lac: getNumber(row.gsm_lac),
        ca_status: "Not exposed",
        source_truth_note: "Direct Android CellIdentityGsm",
        _elapsed: elapsed,
        first_observed: elapsed,
        last_observed: elapsed,
      });
    }
  });

  return Array.from(byKey.values()).map((row) => {
    const { _elapsedFirst, _elapsedLast, ...rest } = row;
    void _elapsedFirst;
    void _elapsedLast;
    return rest;
  });
}

export default {
  deriveLteBandFromEarfcn,
  formatBandwidthMhz,
  buildRfConfigurationRows,
};
