// Session-only flag that keeps the "reset" or "profile deleted" confirmation visible through the reload that
// follows a verified change. The value is the action kind.
export const PROFILE_NOTICE_KEY = 'money-honey-profile-action-done'

function defaultSession() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

// Returns true only if the flag was stored and reads back, so callers know it will survive a reload.
export function markProfileActionComplete(kind, session = defaultSession()) {
  try {
    session.setItem(PROFILE_NOTICE_KEY, kind)
    return session.getItem(PROFILE_NOTICE_KEY) === kind
  } catch {
    return false
  }
}

export function getProfileActionNotice(session = defaultSession()) {
  try {
    const kind = session?.getItem(PROFILE_NOTICE_KEY)
    return kind === 'reset' || kind === 'delete' ? kind : null
  } catch {
    return null
  }
}

export function clearProfileActionNotice(session = defaultSession()) {
  try {
    session?.removeItem(PROFILE_NOTICE_KEY)
  } catch {
    // Nothing to clear if session storage is unavailable.
  }
}
