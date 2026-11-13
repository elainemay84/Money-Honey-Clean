// Session-only flag that keeps the "Backup Restored!" confirmation visible through the reload
// that follows a verified restore. It never leaves the browser tab's session storage.
export const RESTORE_NOTICE_KEY = 'money-honey-backup-restored'

function defaultSession() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

// Returns true only if the flag was stored and reads back, so callers know it will survive a reload.
export function markRestoreComplete(session = defaultSession()) {
  try {
    session.setItem(RESTORE_NOTICE_KEY, '1')
    return session.getItem(RESTORE_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

export function hasRestoreNotice(session = defaultSession()) {
  try {
    return session?.getItem(RESTORE_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

export function clearRestoreNotice(session = defaultSession()) {
  try {
    session?.removeItem(RESTORE_NOTICE_KEY)
  } catch {
    // Nothing to clear if session storage is unavailable.
  }
}
