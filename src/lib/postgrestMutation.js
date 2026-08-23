/**
 * Normalize PostgREST mutation responses.
 * RLS-blocked UPDATE/DELETE often returns success with zero rows
 * and a non-array `data` wrapper instead of a PostgreSQL error.
 */

export function normalizePostgrestMutation(result = {}) {
  const error = result.error || null
  const data = result.data
  const rows = Array.isArray(data) ? data : data == null ? [] : [data]
  const count = typeof result.count === 'number' ? result.count : rows.length
  return {
    error,
    rows,
    count,
    empty: !error && count === 0,
  }
}

export default { normalizePostgrestMutation }
