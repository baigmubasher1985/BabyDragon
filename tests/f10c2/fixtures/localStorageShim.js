/**
 * Minimal localStorage shim for Node vitest (mobile queue / id stores).
 */
export function installLocalStorageShim() {
  if (typeof globalThis.localStorage !== "undefined" && globalThis.localStorage?.getItem) {
    return { already: true }
  }
  const map = new Map()
  globalThis.localStorage = {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(String(key), String(value))
    },
    removeItem(key) {
      map.delete(String(key))
    },
    clear() {
      map.clear()
    },
  }
  return { already: false }
}

export function clearLocalStorageShim() {
  try {
    globalThis.localStorage?.clear?.()
  } catch {
    /* ignore */
  }
}
