/**
 * F10C2 Phase 4 — select mock vs real result transport.
 * Default remains mock. Real transport requires explicit runtime flag + supabase client.
 */

import { isF10C2ServerSubmitRuntimeEnabled } from "../../../lib/f10c2FeatureFlags.js";
import {
  createMockResultTransport,
  getSharedMockResultTransport,
  MOCK_TRANSPORT_KIND,
} from "./mockResultTransport.js";
import {
  createSupabaseResultTransport,
  SUPABASE_TRANSPORT_KIND,
} from "./supabaseResultTransport.js";

let sharedLiveTransport = null;

export function getResultTransportKind() {
  return isF10C2ServerSubmitRuntimeEnabled() ? SUPABASE_TRANSPORT_KIND : MOCK_TRANSPORT_KIND;
}

/**
 * Resolve the transport used by the durable queue processor.
 * @param {object} [options]
 * @param {object} [options.supabase]
 * @param {Function} [options.readArtifactBody]
 * @param {boolean} [options.forceMock]
 */
export function getResultTransport(options = {}) {
  if (options.forceMock || !isF10C2ServerSubmitRuntimeEnabled()) {
    return options.transport || getSharedMockResultTransport();
  }
  if (options.transport) return options.transport;
  if (!options.supabase) {
    throw new Error("supabase_client_required_for_live_result_transport");
  }
  if (!sharedLiveTransport) {
    sharedLiveTransport = createSupabaseResultTransport({
      supabase: options.supabase,
      readArtifactBody: options.readArtifactBody,
    });
  }
  return sharedLiveTransport;
}

export function resetSharedResultTransport() {
  sharedLiveTransport = null;
}

export {
  createMockResultTransport,
  createSupabaseResultTransport,
  MOCK_TRANSPORT_KIND,
  SUPABASE_TRANSPORT_KIND,
};

export default {
  getResultTransportKind,
  getResultTransport,
  resetSharedResultTransport,
};
