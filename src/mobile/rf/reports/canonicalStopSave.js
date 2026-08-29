/**
 * CR1-B-U-R1 — Canonical Stop/Save persistence.
 * Stop/Save builds one package, writes Downloads/BabyDragon/Reports, and
 * registers the same identity in the existing offline upload queue.
 * Does not upload. Export/Excel must not create a second run identity.
 */

import { buildCanonicalPackageIdentity } from "./canonicalPackageIdentity.js";
import { enqueueFieldTestResultSubmit } from "../submission/enqueueFieldTestResult.js";

export const CANONICAL_PERSIST_MODES = Object.freeze({
  CANONICAL: "canonical",
  EXPORT_ARTIFACT: "export_artifact",
  EXCEL: "excel",
});

/**
 * Persist the canonical package and register one queue entry.
 * Callers must only mark Saved when ok === true.
 */
export async function persistCanonicalStopSave({
  session,
  user = null,
  activeTask = null,
  taskContext = null,
  device = {},
  network = {},
  ownerUserId = null,
  buildPackage,
  savePackage,
  enqueue = enqueueFieldTestResultSubmit,
} = {}) {
  if (!session) {
    return { ok: false, stage: "session", error: "No session to save. Keep recording and tap Stop / Save again." };
  }
  const identity = buildCanonicalPackageIdentity(session);
  if (!identity.ok) {
    return { ok: false, stage: "identity", error: "Cannot save: session is missing a durable session id.", identity };
  }

  const sessionWithIdentity = {
    ...session,
    canonicalPackageId: identity.canonicalPackageId,
    scenarioKey: identity.scenarioKey,
  };

  let reportPackage;
  try {
    reportPackage = await buildPackage({
      session: sessionWithIdentity,
      user,
      activeTask,
      persistMode: CANONICAL_PERSIST_MODES.CANONICAL,
    });
  } catch (error) {
    return {
      ok: false,
      stage: "build",
      error: error?.message || "Failed to build the report package. Session was kept; tap Stop / Save to retry.",
      identity,
    };
  }

  if (!reportPackage?.files?.length) {
    return { ok: false, stage: "build", error: "Report package had no files. Session was kept; tap Stop / Save to retry.", identity };
  }

  reportPackage.sessionId = identity.folderId;
  reportPackage.canonicalPackageId = identity.canonicalPackageId;
  reportPackage.overwrite = true;

  let saveResult;
  try {
    saveResult = await savePackage(reportPackage);
  } catch (error) {
    return {
      ok: false,
      stage: "persist",
      error: error?.message || "Could not write the report package to Downloads/BabyDragon/Reports. Session was kept; tap Stop / Save to retry.",
      identity,
      reportPackage,
    };
  }
  if (!saveResult?.ok) {
    return {
      ok: false,
      stage: "persist",
      error: saveResult?.message || "Native report save failed. Session was kept; tap Stop / Save to retry.",
      identity,
      reportPackage,
      saveResult,
    };
  }

  let enqueueResult;
  try {
    enqueueResult = await enqueue({
      session: sessionWithIdentity,
      taskContext,
      device,
      network,
      files: (reportPackage.files || []).map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        content: file.content,
        contentBase64: file.contentBase64,
        path: null,
        artifactType: file.artifactType || null,
      })),
      reportName: reportPackage.displayName || session.reportLogName,
      ownerUserId,
      identityKey: identity.identityKey,
      allowUnassigned: true,
    });
  } catch (error) {
    return {
      ok: false,
      stage: "queue",
      error: error?.message || "Package was written but queue registration failed. Session was kept; tap Stop / Save to retry.",
      identity,
      reportPackage,
      saveResult,
    };
  }
  if (!enqueueResult?.ok) {
    return {
      ok: false,
      stage: "queue",
      error: `Package was written but queue registration failed (${enqueueResult?.reason || "unknown"}). Session was kept; tap Stop / Save to retry.`,
      identity,
      reportPackage,
      saveResult,
      enqueueResult,
    };
  }

  return {
    ok: true,
    identity,
    reportPackage,
    saveResult,
    enqueueResult,
    uploaded: false,
  };
}

export function shouldEnqueueForPersistMode(persistMode) {
  return persistMode === CANONICAL_PERSIST_MODES.CANONICAL;
}

export default {
  persistCanonicalStopSave,
  shouldEnqueueForPersistMode,
  CANONICAL_PERSIST_MODES,
};
