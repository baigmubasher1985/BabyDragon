/**
 * F10C2 Phase 4A — typed deployment / storage configuration.
 * Frontend may only carry public-safe values. Server secrets stay off the client.
 */

import {
  DEFAULT_MAX_ARTIFACT_BYTES,
  DEFAULT_SIGNED_TTL_SECONDS,
  DEPLOYMENT_MODES,
  FORBIDDEN_CLIENT_SECRET_KEYS,
  PROCESSING_LOCATIONS,
  PROVIDER_TYPES,
} from "./artifactStorageTypes.js";

const MODE_VALUES = new Set(Object.values(DEPLOYMENT_MODES));
const PROVIDER_VALUES = new Set(Object.values(PROVIDER_TYPES));
const PROCESSING_VALUES = new Set(Object.values(PROCESSING_LOCATIONS));

function readEnv(name) {
  try {
    const meta = import.meta.env;
    if (meta && meta[name] != null && String(meta[name]).trim() !== "") {
      return String(meta[name]).trim();
    }
  } catch {
    // ignore
  }
  return "";
}

function asBoolean(raw, fallback = false) {
  if (raw == null || raw === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return fallback;
}

export function validateDeploymentConfig(input = {}) {
  const errors = [];
  const deploymentMode = input.deploymentMode || DEPLOYMENT_MODES.MOBBITECH_SAAS;
  if (!MODE_VALUES.has(deploymentMode)) {
    errors.push({ code: "deployment_mode_invalid", message: "Unknown deployment mode." });
  }

  const defaultProvider = input.defaultProvider || PROVIDER_TYPES.MOCK;
  if (!PROVIDER_VALUES.has(defaultProvider)) {
    errors.push({ code: "default_provider_invalid", message: "Unknown default storage provider." });
  }

  const enabledProviders = Array.isArray(input.enabledProviders)
    ? input.enabledProviders
    : [defaultProvider];
  for (const p of enabledProviders) {
    if (!PROVIDER_VALUES.has(p)) {
      errors.push({ code: "enabled_provider_invalid", message: `Unknown provider ${p}` });
    }
  }

  const processingLocation = input.processingLocation || PROCESSING_LOCATIONS.MOBBI_CLOUD;
  if (!PROCESSING_VALUES.has(processingLocation)) {
    errors.push({ code: "processing_location_invalid", message: "Unknown processing location." });
  }

  const maxFileSize = Number(input.maxFileSize || DEFAULT_MAX_ARTIFACT_BYTES);
  if (!Number.isFinite(maxFileSize) || maxFileSize <= 0) {
    errors.push({ code: "max_file_size_invalid", message: "Upload limit must be a positive number." });
  }

  const connectorTimeoutMs = Number(input.connectorTimeoutMs || 15000);
  const connectorRetries = Number(input.connectorRetries ?? 3);
  if (!Number.isFinite(connectorTimeoutMs) || connectorTimeoutMs < 250) {
    errors.push({ code: "timeout_invalid", message: "Connector timeout is too low." });
  }
  if (!Number.isFinite(connectorRetries) || connectorRetries < 0 || connectorRetries > 12) {
    errors.push({ code: "retries_invalid", message: "Connector retry count is out of range." });
  }

  const blob = JSON.stringify(input);
  for (const key of FORBIDDEN_CLIENT_SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key]) {
      errors.push({ code: "client_secret_forbidden", message: "Server credential is not allowed in client config." });
    }
    if (blob.toLowerCase().includes(String(key).toLowerCase()) && /eyJ|sk-|secret/.test(blob)) {
      errors.push({ code: "client_secret_forbidden", message: "Server credential material is not allowed in client config." });
    }
  }

  if (input.apiBaseUrl && /^https?:\/\//i.test(input.apiBaseUrl) === false && input.apiBaseUrl !== "/") {
    errors.push({ code: "api_base_url_invalid", message: "API base URL must be an http(s) URL or '/'." });
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      deploymentMode,
      apiBaseUrl: input.apiBaseUrl || "",
      controlPlaneUrl: input.controlPlaneUrl || "",
      tenantSlug: input.tenantSlug || null,
      defaultProvider,
      enabledProviders,
      processingLocation,
      allowTemporaryCache: asBoolean(input.allowTemporaryCache, false),
      maxFileSize,
      signedUrlTtlSeconds: Number(input.signedUrlTtlSeconds) || DEFAULT_SIGNED_TTL_SECONDS,
      connectorTimeoutMs,
      connectorRetries,
    },
  };
}

export function loadPublicDeploymentConfig() {
  return validateDeploymentConfig({
    deploymentMode: readEnv("VITE_BD_DEPLOYMENT_MODE") || DEPLOYMENT_MODES.MOBBITECH_SAAS,
    apiBaseUrl: readEnv("VITE_BD_API_BASE_URL"),
    controlPlaneUrl: readEnv("VITE_BD_CONTROL_PLANE_URL"),
    tenantSlug: readEnv("VITE_BD_TENANT_SLUG") || null,
    defaultProvider: readEnv("VITE_BD_DEFAULT_STORAGE_PROVIDER") || PROVIDER_TYPES.MOCK,
    enabledProviders: (readEnv("VITE_BD_ENABLED_STORAGE_PROVIDERS") || "mock")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    processingLocation: readEnv("VITE_BD_PROCESSING_LOCATION") || PROCESSING_LOCATIONS.MOBBI_CLOUD,
    allowTemporaryCache: readEnv("VITE_BD_ALLOW_TEMPORARY_CACHE"),
    maxFileSize: readEnv("VITE_BD_MAX_ARTIFACT_BYTES") || DEFAULT_MAX_ARTIFACT_BYTES,
  });
}

export default {
  validateDeploymentConfig,
  loadPublicDeploymentConfig,
};
