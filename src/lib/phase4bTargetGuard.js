/**
 * F10C2 Phase 4B — extra fail-closed checks on top of Phase 4 disposable identity.
 * Does not connect to Supabase or PostgreSQL.
 *
 * DB URI identity:
 * - Direct: hostname db.<project-ref>.supabase.co
 * - Session pooler: hostname ends with .pooler.supabase.com AND
 *   username = postgres.<project-ref> AND port 5432
 * Pooler hostnames do not need to contain the project ref.
 */

import { evaluateDisposableTarget } from "./disposableSupabaseGuard.js";

export const EXPECTED_DISPOSABLE_PROJECT_NAME = "babydragon-f10c2-disposable";
export const AUTHORIZED_DISPOSABLE_PROJECT_REF = "cxyqqgmepiphyejvceum";
export const AUTHORIZED_DISPOSABLE_API_HOST = `${AUTHORIZED_DISPOSABLE_PROJECT_REF}.supabase.co`;
/** Transcription error; must never be treated as authorized. */
export const WITHDRAWN_TRANSCRIPTION_REF = "cxyqggmepiphyejvceum";
export const DENIED_PRODUCTION_REF_PREFIX = "nsne";
export const SESSION_POOLER_HOST_SUFFIX = ".pooler.supabase.com";

function trimStr(value) {
  return String(value || "").trim();
}

function hostnameFromUrlOrHost(raw) {
  const value = trimStr(raw);
  if (!value) return "";
  try {
    const normalized = /^https?:\/\//i.test(value) || value.includes("://")
      ? value.replace(/^postgres(ql)?:/i, "https:")
      : `https://${value}`;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return value.split("/")[0].split(":")[0].toLowerCase();
  }
}

function dbHostFromUrl(dbUrl) {
  const raw = trimStr(dbUrl);
  if (!raw) return "";
  try {
    const normalized = raw.replace(/^postgres(ql)?:/i, "https:");
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function sanitizeHostname(hostname) {
  const host = trimStr(hostname).toLowerCase();
  if (!host) return "(none)";
  if (host.endsWith(SESSION_POOLER_HOST_SUFFIX)) {
    const prefix = host.slice(0, Math.min(4, host.length));
    return `${prefix}…${SESSION_POOLER_HOST_SUFFIX}`;
  }
  if (host.length < 8) return `${host.slice(0, 2)}…`;
  return `${host.slice(0, 4)}…${host.slice(-4)}`;
}

function splitPostgresUri(raw) {
  const value = trimStr(raw).replace(/^\uFEFF/, "");
  const duplicatedScheme = /^postgres(?:ql)?:postgres(?:ql)?:\/\//i.test(value)
    || /^postgresql:postgresql:/i.test(value);
  const schemeMatch = value.match(/^(postgres(?:ql)?):\/\//i);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "";
  const rest = schemeMatch ? value.slice(schemeMatch[0].length) : "";
  const at = rest.lastIndexOf("@");
  if (!schemeMatch || at < 0) {
    return {
      duplicatedScheme,
      scheme,
      username: "",
      hostname: "",
      port: null,
      database: "",
    };
  }
  const userinfo = rest.slice(0, at);
  const hostpart = rest.slice(at + 1);
  const colon = userinfo.indexOf(":");
  let username = colon >= 0 ? userinfo.slice(0, colon) : userinfo;
  try {
    username = decodeURIComponent(username);
  } catch {
    /* keep raw username */
  }
  let cut = hostpart.length;
  const slash = hostpart.indexOf("/");
  const query = hostpart.indexOf("?");
  if (slash >= 0) cut = Math.min(cut, slash);
  if (query >= 0) cut = Math.min(cut, query);
  const hostPort = hostpart.slice(0, cut);
  const remainder = hostpart.slice(cut);
  let hostname = hostPort;
  let port = 5432;
  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    hostname = end >= 0 ? hostPort.slice(1, end) : hostPort;
    if (end >= 0 && hostPort[end + 1] === ":") {
      port = Number(hostPort.slice(end + 2)) || 5432;
    }
  } else if (hostPort.includes(":")) {
    const idx = hostPort.lastIndexOf(":");
    hostname = hostPort.slice(0, idx);
    port = Number(hostPort.slice(idx + 1)) || 5432;
  }
  let database = "postgres";
  if (remainder.startsWith("/")) {
    database = remainder.slice(1).split("?")[0].split("/")[0] || "postgres";
    try {
      database = decodeURIComponent(database);
    } catch {
      /* keep raw */
    }
  }
  return {
    duplicatedScheme,
    scheme,
    username,
    hostname: hostname.toLowerCase(),
    port,
    database,
  };
}

/**
 * Parse a disposable Postgres URI without logging secrets.
 * @param {string} raw
 * @param {string} expectedRef
 */
export function parseDisposableDbUri(raw, expectedRef) {
  const expected = trimStr(expectedRef).toLowerCase();
  const reasons = [];
  const empty = {
    schemeValid: false,
    mode: "unknown",
    usernameRefMatches: false,
    hostname: "",
    hostnameSanitized: "(none)",
    port: null,
    database: "",
    userRef: "",
    productionRefAbsent: true,
  };

  if (!trimStr(raw)) {
    return { ok: false, reasons: ["disposable DB URL is required"], ...empty };
  }

  const parts = splitPostgresUri(raw);
  if (parts.duplicatedScheme) {
    reasons.push("duplicated URI scheme");
  }
  const schemeValid = parts.scheme === "postgresql" && !parts.duplicatedScheme;
  if (!schemeValid && !parts.duplicatedScheme) {
    reasons.push("scheme must be exactly postgresql://");
  }
  if (!parts.hostname) {
    reasons.push("malformed DB URI");
    return {
      ok: false,
      reasons,
      ...empty,
      schemeValid,
    };
  }

  const username = parts.username;
  const hostname = parts.hostname;
  const port = parts.port;
  const database = parts.database;
  const userMatch = username.toLowerCase().match(/^postgres(?:\.([a-z0-9]+))?$/);
  const userRef = userMatch?.[1] || "";
  const productionRefAbsent = !userRef.startsWith(DENIED_PRODUCTION_REF_PREFIX)
    && !hostname.startsWith(DENIED_PRODUCTION_REF_PREFIX);

  if (!username || !userMatch) {
    reasons.push("missing or malformed username");
  }
  if (port === 6543) {
    reasons.push("transaction pooler port 6543 is rejected");
  }
  if (userRef.startsWith(DENIED_PRODUCTION_REF_PREFIX)) {
    reasons.push("pooler username project ref begins with denied production prefix");
  }

  let mode = "unknown";
  const looksLikeSupabaseDb = hostname.endsWith(SESSION_POOLER_HOST_SUFFIX)
    || hostname.endsWith(".supabase.co")
    || hostname.endsWith(".supabase.com");

  if (hostname.endsWith(SESSION_POOLER_HOST_SUFFIX)) {
    mode = "session pooler";
    if (port !== 5432) {
      reasons.push("session pooler port must be 5432");
    }
    if (database && database !== "postgres") {
      reasons.push("database must be postgres");
    }
    if (expected && username.toLowerCase() !== `postgres.${expected}`) {
      reasons.push("pooler username must be postgres.<authorized-project-ref>");
    }
    if (expected && userRef && userRef !== expected) {
      reasons.push("pooler username for another project");
    }
  } else if (hostname.includes("pooler")) {
    reasons.push("non-Supabase pooler hostname");
  } else if (looksLikeSupabaseDb && expected) {
    mode = "direct";
    const expectedDirect = `db.${expected}.supabase.co`;
    if (hostname !== expectedDirect) {
      reasons.push("direct hostname must be db.<authorized-project-ref>.supabase.co");
    }
    if (
      username
      && username.toLowerCase() !== "postgres"
      && username.toLowerCase() !== `postgres.${expected}`
    ) {
      reasons.push("direct connection username must be postgres or postgres.<authorized-project-ref>");
    }
  }

  if (expected && userRef && looksLikeSupabaseDb && userRef !== expected && mode === "session pooler") {
    reasons.push("ambiguous project identity between API/ref and pooler username");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    schemeValid,
    mode,
    usernameRefMatches: Boolean(expected) && username.toLowerCase() === `postgres.${expected}`,
    hostname,
    hostnameSanitized: sanitizeHostname(hostname),
    port,
    database: database || "(missing)",
    userRef,
    productionRefAbsent,
  };
}

export function evaluatePhase4bTarget(input = {}) {
  const base = evaluateDisposableTarget(input);
  const reasons = [...base.reasons];

  const projectName = trimStr(input.projectName);
  if (projectName !== EXPECTED_DISPOSABLE_PROJECT_NAME) {
    reasons.push(
      `F10C2_DISPOSABLE_PROJECT_NAME must be exactly '${EXPECTED_DISPOSABLE_PROJECT_NAME}'`,
    );
  }

  const synthetic = trimStr(input.syntheticDataMode).toLowerCase();
  if (synthetic !== "yes") {
    reasons.push("F10C2_SYNTHETIC_DATA_MODE must be exactly 'yes'");
  }

  const importMode = trimStr(input.productionDataImport).toLowerCase();
  if (importMode !== "disabled") {
    reasons.push("F10C2_PRODUCTION_DATA_IMPORT must be exactly 'disabled'");
  }

  const disposableRef = trimStr(base.projectRef).toLowerCase();
  if (disposableRef && disposableRef !== "local-disposable" && disposableRef.startsWith(DENIED_PRODUCTION_REF_PREFIX)) {
    reasons.push("disposable project ref matches the denied production prefix");
  }

  const deniedDbHost = hostnameFromUrlOrHost(input.deniedProductionDbHost);
  const disposableDbHost = dbHostFromUrl(input.disposableDbUrl);
  if (deniedDbHost && disposableDbHost && deniedDbHost === disposableDbHost) {
    reasons.push("disposable database host matches denied production database host");
  }

  const appHost = hostnameFromUrlOrHost(input.appViteUrl);
  if (appHost && disposableDbHost && appHost === disposableDbHost) {
    reasons.push("disposable database host matches app/production API host");
  }

  const expectedRef = trimStr(input.explicitDisposableRef).toLowerCase() || disposableRef;
  let dbUri = null;
  if (trimStr(input.disposableDbUrl)) {
    dbUri = parseDisposableDbUri(input.disposableDbUrl, expectedRef);
    reasons.push(...dbUri.reasons);
  }

  const apiHost = trimStr(base.hostname).toLowerCase();
  const explicitRef = trimStr(input.explicitDisposableRef).toLowerCase();
  const poolerUserRef = trimStr(dbUri?.userRef).toLowerCase();
  const withdrawnPresent = [disposableRef, explicitRef, poolerUserRef, expectedRef]
    .some((value) => value === WITHDRAWN_TRANSCRIPTION_REF);
  if (withdrawnPresent) {
    reasons.push("withdrawn transcription-error project ref is not authorized");
  }

  if (!base.local) {
    if (disposableRef && disposableRef !== AUTHORIZED_DISPOSABLE_PROJECT_REF) {
      reasons.push("disposable project ref is not the authorized disposable ref");
    }
    if (apiHost && apiHost !== AUTHORIZED_DISPOSABLE_API_HOST) {
      reasons.push("disposable API host is not the authorized disposable API host");
    }
    if (explicitRef && explicitRef !== AUTHORIZED_DISPOSABLE_PROJECT_REF) {
      reasons.push("F10C2_DISPOSABLE_PROJECT_REF is not the authorized disposable ref");
    }
    if (dbUri?.mode === "session pooler") {
      if (!trimStr(dbUri.hostname).endsWith(SESSION_POOLER_HOST_SUFFIX)) {
        reasons.push("non-Supabase pooler hostname");
      }
      if (dbUri.port !== 5432) {
        reasons.push("session pooler port must be 5432");
      }
      if (poolerUserRef !== AUTHORIZED_DISPOSABLE_PROJECT_REF) {
        reasons.push("pooler username must be postgres.<authorized-project-ref>");
      }
      if (
        disposableRef !== AUTHORIZED_DISPOSABLE_PROJECT_REF
        || apiHost !== AUTHORIZED_DISPOSABLE_API_HOST
        || poolerUserRef !== AUTHORIZED_DISPOSABLE_PROJECT_REF
        || disposableRef !== poolerUserRef
      ) {
        reasons.push(
          "disposable project ref, API host, and pooler username must agree on the authorized disposable identity",
        );
      }
    }
  }

  return {
    ...base,
    ok: reasons.length === 0 && Boolean(base.hostname),
    reasons,
    expectedProjectName: EXPECTED_DISPOSABLE_PROJECT_NAME,
    authorizedProjectRef: AUTHORIZED_DISPOSABLE_PROJECT_REF,
    authorizedApiHost: AUTHORIZED_DISPOSABLE_API_HOST,
    projectName: projectName || null,
    syntheticDataMode: synthetic === "yes",
    productionDataImportDisabled: importMode === "disabled",
    dbHostRedacted: disposableDbHost ? sanitizeHostname(disposableDbHost) : "(none)",
    identitySignalsAgree: Boolean(
      disposableRef === AUTHORIZED_DISPOSABLE_PROJECT_REF
      && apiHost === AUTHORIZED_DISPOSABLE_API_HOST
      && (
        dbUri?.mode !== "session pooler"
        || poolerUserRef === AUTHORIZED_DISPOSABLE_PROJECT_REF
      ),
    ),
    dbUri,
  };
}

export function assertPhase4bTarget(input = {}) {
  const result = evaluatePhase4bTarget(input);
  if (!result.ok) {
    const error = new Error(`phase4b_target_rejected: ${result.reasons.join("; ")}`);
    error.code = "phase4b_target_rejected";
    error.reasons = result.reasons;
    throw error;
  }
  return result;
}

export default {
  EXPECTED_DISPOSABLE_PROJECT_NAME,
  AUTHORIZED_DISPOSABLE_PROJECT_REF,
  AUTHORIZED_DISPOSABLE_API_HOST,
  WITHDRAWN_TRANSCRIPTION_REF,
  DENIED_PRODUCTION_REF_PREFIX,
  SESSION_POOLER_HOST_SUFFIX,
  parseDisposableDbUri,
  evaluatePhase4bTarget,
  assertPhase4bTarget,
};
