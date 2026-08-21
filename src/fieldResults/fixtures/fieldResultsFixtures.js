/**
 * F10C2 Phase 3 — sanitized Field Results fixtures.
 * Synthetic IDs/names only. No real customer data, credentials, or private coordinates.
 * Summaries only — no full RF/GPS traces embedded.
 */

import { FIELD_RESULT_QC_DECISIONS } from '../models/fieldResultTypes.js';

const FE_A = {
  id: 'fe-syn-0001-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'FE Alpha (Synthetic)',
  email: 'fe.alpha.synthetic@example.invalid',
};

const FE_B = {
  id: 'fe-syn-0002-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'FE Bravo (Synthetic)',
  email: 'fe.bravo.synthetic@example.invalid',
};

const ADMIN = {
  id: 'adm-syn-0001-dddd-4ddd-8ddd-dddddddddddd',
  name: 'Admin Reviewer (Synthetic)',
  email: 'admin.qc.synthetic@example.invalid',
};

function baseRun(partial) {
  return {
    id: partial.id,
    client_run_id: partial.client_run_id || `client-${partial.id}`,
    report_name: partial.report_name,
    task_id: partial.task_id || 'task-syn-0001',
    task_name: partial.task_name || 'Synthetic Task JOS-001',
    project_id: partial.project_id || 'proj-syn-0001',
    project_name: partial.project_name || 'Synthetic Demo Project',
    grid_id: partial.grid_id || 'grid-syn-0001',
    grid_name: partial.grid_name || 'Grid SYN-A1',
    market: partial.market || 'Synthetic Market',
    field_engineer: partial.field_engineer || FE_A,
    scenario_type: partial.scenario_type,
    started_at: partial.started_at || '2026-08-10T14:00:00.000Z',
    ended_at: partial.ended_at || '2026-08-10T14:25:00.000Z',
    duration_ms: partial.duration_ms ?? 25 * 60 * 1000,
    completion_status: partial.completion_status || 'success',
    attempt_counts: partial.attempt_counts || {
      requested: 5,
      attempted: 5,
      completed: 5,
      failed: 0,
      remaining: 0,
    },
    upload_state: partial.upload_state || 'uploaded',
    processing_state: partial.processing_state || 'ready',
    latest_qc_status: partial.latest_qc_status || 'Waiting for Logs',
    redrive_needed: partial.redrive_needed === true,
    redrive_task_id: partial.redrive_task_id || null,
    rf_summary_concise: partial.rf_summary_concise || 'LTE dominant · RSRP mid',
    data_summary_concise: partial.data_summary_concise || null,
    device: partial.device || {
      app_version: '0.0.0-f10c2-mock',
      build: 'mock-build-1',
      model: 'Synthetic Device X',
      os: 'Android 14 (mock)',
    },
    overview: partial.overview || {},
    test_summary: partial.test_summary || {},
    rf_summary: partial.rf_summary || null,
    gps_summary: partial.gps_summary || null,
    events_summary: partial.events_summary || null,
    scenario_details: partial.scenario_details || {},
    artifacts: partial.artifacts || [],
    qc_history: partial.qc_history || [],
    has_failures: partial.has_failures === true,
    raw_rf_samples: undefined, // never populate — list/detail must not load raw traces
    ...partial.extra,
  };
}

function artifact(partial) {
  return {
    artifact_id: partial.artifact_id,
    artifact_type: partial.artifact_type,
    filename: partial.filename,
    mime_type: partial.mime_type || 'application/octet-stream',
    size_bytes: partial.size_bytes ?? 1024,
    checksum_status: partial.checksum_status || 'verified',
    upload_status: partial.upload_status || 'uploaded',
    required: partial.required !== false,
    available: partial.available !== false,
    missing: partial.available === false || partial.missing === true,
    // Durable refs only — no public/signed URLs
    bucket: 'result-artifacts',
    object_key_hint: partial.object_key_hint || null,
  };
}

function qcEntry(partial) {
  return {
    id: partial.id,
    decision: partial.decision,
    reviewer_id: partial.reviewer_id || ADMIN.id,
    reviewer_name: partial.reviewer_name || ADMIN.name,
    decided_at: partial.decided_at || '2026-08-11T10:00:00.000Z',
    notes: partial.notes || '',
    missing_evidence: partial.missing_evidence || [],
    redrive_reason: partial.redrive_reason || '',
    redrive_task_id: partial.redrive_task_id || null,
    previous_decision: partial.previous_decision || null,
  };
}

const rfLte = {
  rat_distribution: { LTE: 82, NR: 12, WCDMA: 4, GSM: 2 },
  lte: {
    rsrp: { min: -118, avg: -98, max: -82 },
    rsrq: { min: -18, avg: -11, max: -7 },
    sinr: { min: -2, avg: 8, max: 18 },
    pci: 101,
    earfcn: 1850,
    band: 'B2',
    bandwidth_mhz: 20,
    ca: 'unavailable',
  },
  nr: null,
  wcdma: { rscp: { avg: -92 }, ecno: { avg: -8 } },
  gsm: { rxlev: { avg: -85 } },
  nr_mode: null,
};

const rfNrSa = {
  rat_distribution: { NR: 95, LTE: 5 },
  lte: {
    rsrp: { min: -110, avg: -100, max: -90 },
    rsrq: { min: -14, avg: -10, max: -8 },
    sinr: { min: 0, avg: 6, max: 12 },
    pci: 44,
    earfcn: 675,
    band: 'B12',
    bandwidth_mhz: 10,
    ca: 'unavailable',
  },
  nr: {
    ss_rsrp: { min: -105, avg: -92, max: -78 },
    ss_rsrq: { min: -12, avg: -9, max: -6 },
    ss_sinr: { min: 2, avg: 12, max: 22 },
    pci: 312,
    nrarfcn: 636666,
    band: 'n77',
    bandwidth_mhz: 100,
  },
  wcdma: null,
  gsm: null,
  nr_mode: 'SA',
};

const rfNrNsa = {
  ...rfNrSa,
  rat_distribution: { NR: 60, LTE: 40 },
  nr_mode: 'NSA',
};

const gpsOk = {
  sample_count: 420,
  valid_count: 410,
  invalid_count: 10,
  start: { lat: 32.75, lon: -96.8 },
  end: { lat: 32.78, lon: -96.75 },
  distance_m: 6400,
  duration_ms: 24 * 60 * 1000,
  route_label: 'Synthetic Route A',
  grid_association: 'Grid SYN-A1',
  gaps_warning: null,
};

const gpsMissing = {
  sample_count: 0,
  valid_count: 0,
  invalid_count: 0,
  start: null,
  end: null,
  distance_m: null,
  duration_ms: null,
  route_label: null,
  grid_association: 'Grid SYN-A1',
  gaps_warning: 'GPS data missing for this run',
};

const eventsVoice = {
  counts: {
    radio: 12,
    rat_change: 3,
    pci_change: 5,
    handover: 2,
    data_test: 8,
    voice_mo: 2,
    voice_mt: 1,
    failures: 1,
  },
  timeline: [
    { t: '2026-08-10T14:01:00.000Z', kind: 'data_test_start', label: 'HTTP iteration 1 start' },
    { t: '2026-08-10T14:05:00.000Z', kind: 'rat_change', label: 'LTE → NR' },
    { t: '2026-08-10T14:12:00.000Z', kind: 'voice_mo_start', label: 'MO call start' },
    { t: '2026-08-10T14:13:30.000Z', kind: 'voice_mo_end', label: 'MO call end' },
    { t: '2026-08-10T14:18:00.000Z', kind: 'voice_mt_failure', label: 'MT setup failure' },
  ],
};

/** Fixture catalog — one entry per required Phase 3 scenario/state. */
export function buildFieldResultsFixtures() {
  const runs = [
    baseRun({
      id: 'run-native-http-success',
      report_name: 'Synthetic_NativeHTTP_Success',
      scenario_type: 'native_http',
      completion_status: 'success',
      latest_qc_status: 'Waiting for Logs',
      data_summary_concise: '5/5 HTTP · DL ok',
      test_summary: {
        truth: 'success',
        config: { method: 'GET', iterations: 5, url_host: 'speedtest.example.invalid' },
        failure_summary: null,
        metrics: { dl_mbps_avg: 85.2, ul_mbps_avg: 22.1 },
      },
      rf_summary: rfLte,
      gps_summary: gpsOk,
      events_summary: eventsVoice,
      scenario_details: {
        kind: 'native_http',
        iterations: [
          { n: 1, status: 'ok', dl_mbps: 80, ul_mbps: 20 },
          { n: 2, status: 'ok', dl_mbps: 88, ul_mbps: 23 },
          { n: 3, status: 'ok', dl_mbps: 86, ul_mbps: 22 },
          { n: 4, status: 'ok', dl_mbps: 84, ul_mbps: 21 },
          { n: 5, status: 'ok', dl_mbps: 88, ul_mbps: 24 },
        ],
        failure_categories: [],
      },
      artifacts: [
        artifact({
          artifact_id: 'art-http-json',
          artifact_type: 'unified_json',
          filename: 'Synthetic_NativeHTTP_Success.json',
          mime_type: 'application/json',
        }),
        artifact({
          artifact_id: 'art-http-rf',
          artifact_type: 'rf_csv',
          filename: 'Synthetic_NativeHTTP_Success_RF.csv',
          mime_type: 'text/csv',
        }),
      ],
    }),

    baseRun({
      id: 'run-native-http-cwf',
      report_name: 'Synthetic_NativeHTTP_CompleteWithFailures',
      scenario_type: 'native_http',
      completion_status: 'complete_with_failures',
      has_failures: true,
      attempt_counts: { requested: 5, attempted: 5, completed: 4, failed: 1, remaining: 0 },
      data_summary_concise: '4/5 HTTP · 1 fail',
      latest_qc_status: 'Waiting for Logs',
      test_summary: {
        truth: 'complete_with_failures',
        config: { method: 'GET', iterations: 5 },
        failure_summary: 'Iteration 3 timeout',
        metrics: { dl_mbps_avg: 70.0, ul_mbps_avg: 18.0 },
      },
      rf_summary: rfLte,
      gps_summary: gpsOk,
      events_summary: {
        counts: { radio: 8, data_test: 5, failures: 1 },
        timeline: [
          { t: '2026-08-10T15:03:00.000Z', kind: 'data_test_failure', label: 'HTTP iter 3 timeout' },
        ],
      },
      scenario_details: {
        kind: 'native_http',
        iterations: [
          { n: 1, status: 'ok', dl_mbps: 75, ul_mbps: 19 },
          { n: 2, status: 'ok', dl_mbps: 72, ul_mbps: 18 },
          { n: 3, status: 'failed', failure_category: 'timeout', dl_mbps: null, ul_mbps: null },
          { n: 4, status: 'ok', dl_mbps: 68, ul_mbps: 17 },
          { n: 5, status: 'ok', dl_mbps: 65, ul_mbps: 18 },
        ],
        failure_categories: ['timeout'],
      },
      artifacts: [
        artifact({
          artifact_id: 'art-http-cwf-json',
          artifact_type: 'unified_json',
          filename: 'Synthetic_NativeHTTP_CWF.json',
          mime_type: 'application/json',
        }),
      ],
    }),

    baseRun({
      id: 'run-ftp-updown',
      report_name: 'Synthetic_FTP_UpDown',
      scenario_type: 'ftp',
      field_engineer: FE_B,
      market: 'Synthetic Market East',
      data_summary_concise: 'FTP UL+DL complete',
      test_summary: {
        truth: 'success',
        config: { host: 'ftp.example.invalid', direction: 'both' },
        metrics: { throughput_mbps_avg: 42.5 },
      },
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: {
        kind: 'ftp',
        directions: [
          { direction: 'download', bytes: 50_000_000, duration_ms: 9000, throughput_mbps: 44.4, status: 'ok' },
          { direction: 'upload', bytes: 20_000_000, duration_ms: 5000, throughput_mbps: 32.0, status: 'ok' },
        ],
        iterations: [{ n: 1, status: 'ok' }],
      },
      artifacts: [
        artifact({
          artifact_id: 'art-ftp-csv',
          artifact_type: 'scenario_csv',
          filename: 'Synthetic_FTP_THP.csv',
          mime_type: 'text/csv',
        }),
      ],
    }),

    baseRun({
      id: 'run-iperf3-bidi',
      report_name: 'Synthetic_iPerf3_Bidirectional',
      scenario_type: 'iperf3',
      data_summary_concise: 'iPerf3 bi-dir · 120/40',
      test_summary: {
        truth: 'success',
        config: { mode: 'bidirectional', duration_s: 10 },
        metrics: { dl_mbps_avg: 120.5, ul_mbps_avg: 40.2 },
      },
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: {
        kind: 'iperf3',
        mode: 'bidirectional',
        average_throughput: { dl_mbps: 120.5, ul_mbps: 40.2 },
        bytes: { dl: 150_000_000, ul: 50_000_000 },
        duration_ms: 10000,
        intervals: [
          { s: 0, dl_mbps: 110, ul_mbps: 38 },
          { s: 5, dl_mbps: 125, ul_mbps: 41 },
          { s: 10, dl_mbps: 126, ul_mbps: 42 },
        ],
      },
      artifacts: [
        artifact({
          artifact_id: 'art-iperf-json',
          artifact_type: 'unified_json',
          filename: 'Synthetic_iPerf3.json',
          mime_type: 'application/json',
        }),
      ],
    }),

    baseRun({
      id: 'run-ookla-evidence',
      report_name: 'Synthetic_OOKLA_Evidence',
      scenario_type: 'ookla_app',
      data_summary_concise: 'OOKLA evidence imported',
      test_summary: {
        truth: 'success',
        config: { provider: 'ookla', secret_token: undefined },
        metrics: { provider_dl_mbps: 95.0, provider_ul_mbps: 18.0, ping_ms: 22 },
      },
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: {
        kind: 'ookla_app',
        evidence_status: 'imported',
        provider_metrics: { dl_mbps: 95.0, ul_mbps: 18.0, ping_ms: 22, jitter_ms: 3 },
        imported_evidence: [{ source: 'csv_import', rows: 1 }],
      },
      artifacts: [
        artifact({
          artifact_id: 'art-ookla',
          artifact_type: 'ookla_evidence',
          filename: 'Synthetic_OOKLA_evidence.csv',
          mime_type: 'text/csv',
        }),
      ],
    }),

    baseRun({
      id: 'run-fcc-evidence',
      report_name: 'Synthetic_FCC_Evidence',
      scenario_type: 'fcc_app',
      data_summary_concise: 'FCC evidence imported',
      test_summary: {
        truth: 'success',
        metrics: { provider_dl_mbps: 110.0, provider_ul_mbps: 25.0 },
      },
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: {
        kind: 'fcc_app',
        evidence_status: 'imported',
        provider_metrics: { dl_mbps: 110.0, ul_mbps: 25.0 },
        imported_evidence: [{ source: 'app_export', rows: 3 }],
      },
      artifacts: [
        artifact({
          artifact_id: 'art-fcc',
          artifact_type: 'fcc_evidence',
          filename: 'Synthetic_FCC_export.zip',
          mime_type: 'application/zip',
        }),
      ],
    }),

    baseRun({
      id: 'run-rf-only',
      report_name: 'Synthetic_RF_Only',
      scenario_type: 'rf_data',
      data_summary_concise: null,
      rf_summary_concise: 'RF/GPS/events only',
      attempt_counts: { requested: 0, attempted: 0, completed: 0, failed: 0, remaining: 0 },
      test_summary: {
        truth: 'success',
        config: { mode: 'rf_only' },
        metrics: null,
        note: 'No throughput metrics for RF-only runs',
      },
      rf_summary: rfLte,
      gps_summary: gpsOk,
      events_summary: {
        counts: { radio: 20, rat_change: 4, pci_change: 8 },
        timeline: [{ t: '2026-08-10T16:00:00.000Z', kind: 'pci_change', label: 'PCI 101 → 205' }],
      },
      scenario_details: {
        kind: 'rf_data',
        note: 'RF/GPS/event truth without fake throughput',
      },
      artifacts: [
        artifact({
          artifact_id: 'art-rf-csv',
          artifact_type: 'rf_csv',
          filename: 'Synthetic_RF_Only_RF.csv',
          mime_type: 'text/csv',
        }),
        artifact({
          artifact_id: 'art-gps-csv',
          artifact_type: 'gps_csv',
          filename: 'Synthetic_RF_Only_GPS.csv',
          mime_type: 'text/csv',
        }),
        artifact({
          artifact_id: 'art-events-csv',
          artifact_type: 'events_csv',
          filename: 'Synthetic_RF_Only_Events.csv',
          mime_type: 'text/csv',
        }),
      ],
    }),

    baseRun({
      id: 'run-interrupted',
      report_name: 'Synthetic_Interrupted_Run',
      scenario_type: 'native_http',
      completion_status: 'interrupted',
      has_failures: true,
      attempt_counts: { requested: 10, attempted: 4, completed: 3, failed: 1, remaining: 6 },
      upload_state: 'partial',
      processing_state: 'incomplete',
      latest_qc_status: 'Waiting for Processing',
      data_summary_concise: 'Interrupted mid-run',
      test_summary: {
        truth: 'interrupted',
        failure_summary: 'Session stopped by operator',
      },
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: { kind: 'native_http', iterations: [{ n: 1, status: 'ok' }, { n: 2, status: 'interrupted' }] },
      artifacts: [
        artifact({
          artifact_id: 'art-int-json',
          artifact_type: 'unified_json',
          filename: 'Synthetic_Interrupted.json',
          mime_type: 'application/json',
          upload_status: 'uploaded',
        }),
        artifact({
          artifact_id: 'art-int-xlsx',
          artifact_type: 'excel_plot',
          filename: 'Synthetic_Interrupted.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upload_status: 'pending',
          available: false,
          required: false,
        }),
      ],
    }),

    baseRun({
      id: 'run-missing-gps',
      report_name: 'Synthetic_Missing_GPS',
      scenario_type: 'ftp',
      data_summary_concise: 'FTP ok · GPS missing',
      rf_summary: rfLte,
      gps_summary: gpsMissing,
      scenario_details: {
        kind: 'ftp',
        directions: [{ direction: 'download', bytes: 10_000_000, duration_ms: 4000, throughput_mbps: 20, status: 'ok' }],
      },
      artifacts: [
        artifact({
          artifact_id: 'art-mgps',
          artifact_type: 'unified_json',
          filename: 'Synthetic_MissingGPS.json',
          mime_type: 'application/json',
        }),
      ],
    }),

    baseRun({
      id: 'run-missing-rf',
      report_name: 'Synthetic_Missing_RF_Metrics',
      scenario_type: 'native_http',
      rf_summary_concise: 'RF metrics unavailable',
      data_summary_concise: 'HTTP ok · RF unavailable',
      rf_summary: {
        rat_distribution: null,
        lte: {
          rsrp: null,
          rsrq: null,
          sinr: null,
          pci: null,
          earfcn: null,
          band: null,
          bandwidth_mhz: null,
          ca: null,
        },
        nr: null,
        wcdma: null,
        gsm: null,
        nr_mode: null,
        unavailable_reason: 'RF metrics not captured for this session',
      },
      gps_summary: gpsOk,
      scenario_details: { kind: 'native_http', iterations: [{ n: 1, status: 'ok', dl_mbps: 50, ul_mbps: 10 }] },
      artifacts: [
        artifact({
          artifact_id: 'art-mrf',
          artifact_type: 'unified_json',
          filename: 'Synthetic_MissingRF.json',
          mime_type: 'application/json',
        }),
      ],
    }),

    baseRun({
      id: 'run-nr-sa',
      report_name: 'Synthetic_NR_SA',
      scenario_type: 'rf_data',
      rf_summary_concise: 'NR SA dominant',
      rf_summary: rfNrSa,
      gps_summary: gpsOk,
      scenario_details: { kind: 'rf_data', nr_mode: 'SA' },
      artifacts: [
        artifact({
          artifact_id: 'art-nrsa',
          artifact_type: 'rf_csv',
          filename: 'Synthetic_NR_SA_RF.csv',
          mime_type: 'text/csv',
        }),
      ],
    }),

    baseRun({
      id: 'run-nr-nsa',
      report_name: 'Synthetic_NR_NSA',
      scenario_type: 'rf_data',
      rf_summary_concise: 'NR NSA',
      rf_summary: rfNrNsa,
      gps_summary: gpsOk,
      scenario_details: { kind: 'rf_data', nr_mode: 'NSA' },
      artifacts: [
        artifact({
          artifact_id: 'art-nrnsa',
          artifact_type: 'rf_csv',
          filename: 'Synthetic_NR_NSA_RF.csv',
          mime_type: 'text/csv',
        }),
      ],
    }),

    baseRun({
      id: 'run-voice-events',
      report_name: 'Synthetic_Voice_Events',
      scenario_type: 'rf_data',
      rf_summary_concise: 'Voice MO/MT events',
      rf_summary: rfLte,
      gps_summary: gpsOk,
      events_summary: eventsVoice,
      scenario_details: { kind: 'rf_data', voice: true },
      artifacts: [
        artifact({
          artifact_id: 'art-voice',
          artifact_type: 'events_csv',
          filename: 'Synthetic_Voice_Events.csv',
          mime_type: 'text/csv',
        }),
      ],
    }),

    baseRun({
      id: 'run-missing-artifact',
      report_name: 'Synthetic_Missing_Required_Artifact',
      scenario_type: 'iperf3',
      has_failures: false,
      data_summary_concise: 'iPerf3 · missing required artifact',
      latest_qc_status: 'Missing Evidence',
      test_summary: { truth: 'success', metrics: { dl_mbps_avg: 100 } },
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: {
        kind: 'iperf3',
        mode: 'download',
        average_throughput: { dl_mbps: 100, ul_mbps: null },
      },
      artifacts: [
        artifact({
          artifact_id: 'art-miss-req',
          artifact_type: 'unified_json',
          filename: 'Synthetic_MissingArt.json',
          mime_type: 'application/json',
          available: false,
          missing: true,
          required: true,
          upload_status: 'missing',
        }),
      ],
      qc_history: [
        qcEntry({
          id: 'qc-miss-1',
          decision: 'Missing Evidence',
          notes: 'Required unified JSON not available',
          missing_evidence: ['unified_json'],
          previous_decision: null,
        }),
      ],
    }),

    baseRun({
      id: 'run-partial-upload',
      report_name: 'Synthetic_Partial_Upload',
      scenario_type: 'native_http',
      upload_state: 'partial',
      processing_state: 'processing',
      latest_qc_status: 'Waiting for Processing',
      data_summary_concise: 'Partial upload in progress',
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: { kind: 'native_http', iterations: [{ n: 1, status: 'ok' }] },
      artifacts: [
        artifact({
          artifact_id: 'art-part-1',
          artifact_type: 'unified_json',
          filename: 'Synthetic_Partial.json',
          mime_type: 'application/json',
          upload_status: 'uploaded',
        }),
        artifact({
          artifact_id: 'art-part-2',
          artifact_type: 'rf_csv',
          filename: 'Synthetic_Partial_RF.csv',
          mime_type: 'text/csv',
          upload_status: 'uploading',
          available: false,
          required: true,
        }),
      ],
    }),

    baseRun({
      id: 'run-processing',
      report_name: 'Synthetic_Processing_Result',
      scenario_type: 'fcc_app',
      upload_state: 'uploaded',
      processing_state: 'processing',
      latest_qc_status: 'Waiting for Processing',
      data_summary_concise: 'Server processing mock',
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: { kind: 'fcc_app', evidence_status: 'processing' },
      artifacts: [
        artifact({
          artifact_id: 'art-proc',
          artifact_type: 'fcc_evidence',
          filename: 'Synthetic_Processing_FCC.zip',
          mime_type: 'application/zip',
        }),
      ],
    }),

    baseRun({
      id: 'run-qc-passed',
      report_name: 'Synthetic_QC_Passed',
      scenario_type: 'native_http',
      latest_qc_status: 'QC Passed',
      data_summary_concise: 'QC Passed example',
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: { kind: 'native_http', iterations: [{ n: 1, status: 'ok', dl_mbps: 90, ul_mbps: 20 }] },
      artifacts: [
        artifact({
          artifact_id: 'art-pass',
          artifact_type: 'unified_json',
          filename: 'Synthetic_QC_Passed.json',
          mime_type: 'application/json',
        }),
      ],
      qc_history: [
        qcEntry({
          id: 'qc-pass-1',
          decision: 'Waiting for Logs',
          notes: 'Initial queue',
          decided_at: '2026-08-11T09:00:00.000Z',
        }),
        qcEntry({
          id: 'qc-pass-2',
          decision: 'QC Passed',
          notes: 'Artifacts complete; human review pass',
          previous_decision: 'Waiting for Logs',
          decided_at: '2026-08-11T11:00:00.000Z',
        }),
      ],
    }),

    baseRun({
      id: 'run-qc-failed',
      report_name: 'Synthetic_QC_Failed',
      scenario_type: 'ftp',
      latest_qc_status: 'QC Failed',
      has_failures: true,
      data_summary_concise: 'QC Failed example',
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: { kind: 'ftp', directions: [{ direction: 'upload', status: 'failed' }] },
      artifacts: [
        artifact({
          artifact_id: 'art-fail',
          artifact_type: 'unified_json',
          filename: 'Synthetic_QC_Failed.json',
          mime_type: 'application/json',
        }),
      ],
      qc_history: [
        qcEntry({
          id: 'qc-fail-1',
          decision: 'QC Failed',
          notes: 'Throughput below acceptance criteria',
        }),
      ],
    }),

    baseRun({
      id: 'run-needs-redrive',
      report_name: 'Synthetic_Needs_Redrive',
      scenario_type: 'ookla_app',
      latest_qc_status: 'Needs Re-drive',
      redrive_needed: true,
      redrive_task_id: null,
      data_summary_concise: 'Needs re-drive',
      rf_summary: rfLte,
      gps_summary: gpsMissing,
      scenario_details: { kind: 'ookla_app', evidence_status: 'incomplete' },
      artifacts: [
        artifact({
          artifact_id: 'art-rd',
          artifact_type: 'ookla_evidence',
          filename: 'Synthetic_NeedsRedrive.csv',
          mime_type: 'text/csv',
        }),
      ],
      qc_history: [
        qcEntry({
          id: 'qc-rd-1',
          decision: 'Needs Re-drive',
          notes: 'GPS missing; re-drive required',
          redrive_reason: 'Missing GPS coverage on assigned grid',
        }),
      ],
    }),

    baseRun({
      id: 'run-linked-redrive',
      report_name: 'Synthetic_Linked_Redrive',
      scenario_type: 'native_http',
      latest_qc_status: 'Needs Re-drive',
      redrive_needed: true,
      redrive_task_id: 'task-redrive-syn-0009',
      task_id: 'task-syn-original-0008',
      task_name: 'Synthetic Original Task',
      data_summary_concise: 'Re-drive linked',
      rf_summary: rfLte,
      gps_summary: gpsOk,
      scenario_details: { kind: 'native_http', iterations: [{ n: 1, status: 'failed' }] },
      artifacts: [
        artifact({
          artifact_id: 'art-lrd',
          artifact_type: 'unified_json',
          filename: 'Synthetic_LinkedRedrive.json',
          mime_type: 'application/json',
        }),
      ],
      qc_history: [
        qcEntry({
          id: 'qc-lrd-1',
          decision: 'Needs Re-drive',
          notes: 'Linked to future re-drive task',
          redrive_reason: 'Coverage hole on north sector',
          redrive_task_id: 'task-redrive-syn-0009',
        }),
      ],
    }),
  ];

  return {
    version: 'f10c2-phase3-fixtures-1',
    actors: { FE_A, FE_B, ADMIN },
    runs,
    qcDecisions: FIELD_RESULT_QC_DECISIONS,
  };
}

export function cloneFixtures() {
  return structuredClone(buildFieldResultsFixtures());
}
