/**
 * Guarded localStorage JSON access for the persisted stores (mode, prefs,
 * observer). Storage is untrusted and may be missing (private mode, blocked
 * site data), so every failure degrades to "nothing stored" / in-memory
 * only; each store keeps its own field validation in `parse`.
 */

/**
 * The JSON stored under `key`, run through `parse`. Undefined when nothing
 * is stored, storage is unavailable, the JSON is corrupt, or `parse` throws —
 * the caller falls back to its defaults.
 */
export function readStored<T>(key: string, parse: (value: unknown) => T): T | undefined {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? undefined : parse(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/** Persist `value` as JSON under `key`; when storage is unavailable the app keeps working in-memory. */
export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable or full — state lives in memory for this session
  }
}
