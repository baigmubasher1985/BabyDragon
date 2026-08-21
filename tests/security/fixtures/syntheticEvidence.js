/**
 * Synthetic operational-evidence artifacts for F10C1I Phase 1 contracts.
 * No production Storage paths, signed URLs, or real files.
 */

import { SYNTHETIC_UUIDS } from './syntheticActors.js'

export const OPS_BUCKET = 'operational-evidence'
export const LEGACY_OPS_BUCKET = 'task-photos'
/** Future F10C2 results bucket — must not be created in Phase 1. */
export const FUTURE_RESULTS_BUCKET = 'result-artifacts'

export const MAX_OPS_BYTES = 15 * 1024 * 1024 // 15 MB
export const ALLOWED_OPS_MIME = Object.freeze(['image/jpeg', 'image/png'])
export const ALLOWED_OPS_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png'])

/**
 * Canonical private ops object_key — no bucket prefix, no user-supplied filename.
 * bucket = operational-evidence
 * object_key = {project_id}/{task_id}/{verified_user_id}/{artifact_id}.{safe_extension}
 */
export function buildOperationalEvidenceKey({
  projectId,
  taskId,
  verifiedUserId,
  artifactId,
  safeExtension,
}) {
  const ext = String(safeExtension || '')
    .toLowerCase()
    .replace(/^\./, '')
  if (!ALLOWED_OPS_EXTENSIONS.includes(ext)) {
    throw new Error('unsafe_extension')
  }
  const normalized = ext === 'jpeg' ? 'jpg' : ext
  return `${projectId}/${taskId}/${verifiedUserId}/${artifactId}.${normalized}`
}

export function durableDbRef(bucket, objectKey) {
  return { bucket, object_key: objectKey }
}

export const SAMPLE_ARTIFACT = {
  project_id: SYNTHETIC_UUIDS.project,
  task_id: SYNTHETIC_UUIDS.taskAssignedToFeA,
  verified_user_id: SYNTHETIC_UUIDS.feA,
  artifact_id: SYNTHETIC_UUIDS.artifact,
  safe_extension: 'jpg',
  mime: 'image/jpeg',
  size_bytes: 1024 * 512,
  checksum: 'sha256:synthetic-checksum-not-a-secret',
}

export function acceptsOpsUpload({ mime, sizeBytes }) {
  if (!ALLOWED_OPS_MIME.includes(mime)) return false
  if (typeof sizeBytes !== 'number' || sizeBytes < 0) return false
  if (sizeBytes > MAX_OPS_BYTES) return false
  return true
}
