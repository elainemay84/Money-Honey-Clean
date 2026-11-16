const RELOAD_ATTEMPT_KEY = 'money-honey-update-reload'
const RESUME_THROTTLE_MS = 10 * 1000
const BUILD_PATTERN = /^[0-9a-f]{8,64}$/

export function getRunningBuild(doc = document) {
  return doc.querySelector('meta[name="money-honey-build"]')?.content || null
}

export async function fetchLatestBuild(fetchImpl = fetch, base = import.meta.env?.BASE_URL ?? '/') {
  try {
    const response = await fetchImpl(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return null
    const data = await response.json()
    return typeof data?.build === 'string' && BUILD_PATTERN.test(data.build) ? data.build : null
  } catch {
    return null
  }
}

export function isUserEditing(doc = document) {
  if (doc.querySelector('form, dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]')) return true
  const active = doc.activeElement
  return Boolean(active && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)))
}

function readAttempt(storage) {
  try { return storage.getItem(RELOAD_ATTEMPT_KEY) } catch { return null }
}

function writeAttempt(storage, build) {
  try {
    storage.setItem(RELOAD_ATTEMPT_KEY, build)
    return true
  } catch {
    return false
  }
}

// Checks for a newer deployment at launch and whenever the app returns to the foreground.
// It reloads automatically only at those moments and only when no form or dialog is open;
// otherwise it reports the update so the user can reload when ready. Saved data is never touched.
export function startUpdateWatcher({
  onUpdate,
  win = window,
  doc = document,
  fetchImpl = (...args) => win.fetch(...args),
  storage = win.sessionStorage,
  reload = () => win.location.reload(),
  intervalMs = 30 * 60 * 1000
} = {}) {
  const running = getRunningBuild(doc)
  if (!running) return () => {}
  let stopped = false
  let checking = false
  let lastCheck = 0

  async function check(reason) {
    if (stopped || checking || doc.visibilityState === 'hidden') return
    if (reason === 'resume' && Date.now() - lastCheck < RESUME_THROTTLE_MS) return
    checking = true
    lastCheck = Date.now()
    const latest = await fetchLatestBuild(fetchImpl)
    checking = false
    if (stopped || !latest || latest === running) return
    const automatic = (reason === 'launch' || reason === 'resume')
      && !isUserEditing(doc)
      && readAttempt(storage) !== latest
    if (automatic && writeAttempt(storage, latest)) {
      reload()
      return
    }
    onUpdate?.(latest)
  }

  const onVisible = () => { if (doc.visibilityState === 'visible') check('resume') }
  const onPageShow = event => { if (event.persisted) check('resume') }
  const onOnline = () => check('online')
  doc.addEventListener('visibilitychange', onVisible)
  win.addEventListener('pageshow', onPageShow)
  win.addEventListener('focus', onVisible)
  win.addEventListener('online', onOnline)
  const timer = win.setInterval(() => check('interval'), intervalMs)
  check('launch')

  return () => {
    stopped = true
    doc.removeEventListener('visibilitychange', onVisible)
    win.removeEventListener('pageshow', onPageShow)
    win.removeEventListener('focus', onVisible)
    win.removeEventListener('online', onOnline)
    win.clearInterval(timer)
  }
}
