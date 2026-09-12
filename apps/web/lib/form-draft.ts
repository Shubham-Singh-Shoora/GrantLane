/**
 * Form drafts, kept in the browser.
 *
 * Long forms lose people: a refresh, a failed submit or a wallet popup that
 * reloads the tab shouldn't cost someone their application. Nothing here leaves
 * the device — it is the applicant's own browser storage, not the server.
 *
 * Every accessor is guarded: localStorage throws outright in some privacy modes,
 * and a draft is never important enough to break a page over.
 */

const PREFIX = "grantlane:draft:";

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full — the form still works, it just won't survive a reload.
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignored
  }
}
