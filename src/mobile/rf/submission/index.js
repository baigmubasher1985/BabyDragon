/**
 * F10C2 Phase 2 — Mobile result packaging + durable offline upload (mocked transport).
 */

export {
  PACKAGE_STATES,
  ARTIFACT_STATES,
  isPackageTerminal,
  isPackageSuccess,
  canResumePackage,
  canManualRetry,
} from "./resultPackageStates.js";

export {
  MAX_UPLOAD_ATTEMPTS,
  backoffDelayMs,
  backoffDelayMsWithJitter,
  classifyUploadError,
  sanitizeFeError,
} from "./resultRetryPolicy.js";

export {
  evaluateResultAuthGate,
  stripSecretsFromPayload,
  assertNoSecretsInRecord,
} from "./resultAuthGate.js";

export {
  getOrCreateClientRunId,
  getOrCreateArtifactId,
  buildRunIdentityKey,
  peekClientRunId,
  makeUuid,
} from "./clientRunIdStore.js";

export {
  stripAbsolutePath,
  rejectUnsafePath,
  buildLocalArtifactRecord,
  toServerArtifactDescriptor,
  computeChecksumHex,
  buildLocalArtifactsFromReportFiles,
  inferArtifactType,
} from "./artifactLocalDescriptors.js";

export {
  adaptScenarioForSubmission,
  adaptUnifiedScenarios,
  buildScenarioConfigSnapshot,
} from "./scenarioResultAdapters.js";

export {
  MOCK_TRANSPORT_KIND,
  MOCK_FAILURE_MODES,
  createMockResultTransport,
  getSharedMockResultTransport,
} from "./mockResultTransport.js";

export {
  SUPABASE_TRANSPORT_KIND,
  createSupabaseResultTransport,
} from "./supabaseResultTransport.js";

export {
  getResultTransportKind,
  getResultTransport,
  resetSharedResultTransport,
} from "./resultTransportFactory.js";

export {
  assertUploadPlanSafe,
  buildClientUploadRequest,
  applyUploadPlanToArtifact,
} from "./artifactUploadPlan.js";

export {
  F10C2_MOCK_RESULT_UPLOAD_ENABLED,
  RESULT_QUEUE_RECORD_VERSION,
  buildResultPackagePayload,
  processResultPackagePayload,
  cancelResultPackageLocally,
  summarizeResultPackage,
} from "./resultUploadOrchestrator.js";

export {
  enqueueFieldTestResultSubmit,
  tryEnqueueFieldTestResultAfterSave,
  cancelQueuedFieldTestResult,
  listFieldTestResultQueueItems,
  ensureArtifactChecksums,
} from "./enqueueFieldTestResult.js";
