import { useEffect, useState } from 'react'
import { isUserEditing, startUpdateWatcher } from './appUpdate.js'

export default function UpdateNotice() {
  const [available, setAvailable] = useState(null)
  const [dismissed, setDismissed] = useState(null)

  useEffect(() => startUpdateWatcher({ onUpdate: setAvailable }), [])

  if (!available || dismissed === available) return null

  function reloadNow() {
    if (isUserEditing() && !window.confirm('Reload now? Anything not yet saved in the open form will be lost.')) return
    window.location.reload()
  }

  const buttonStyle = { border: 0, borderRadius: 10, padding: '7px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }
  return (
    <div role="status" aria-live="polite" style={{
      position: 'fixed', left: 24, right: 24, zIndex: 16,
      bottom: 'calc(env(safe-area-inset-bottom) + 92px)',
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px 8px 14px',
      background: 'var(--theme-card, #FFFDF8)', color: 'var(--theme-text, #4A3426)',
      border: '1px solid var(--theme-border, #E9D6B7)', borderRadius: 14,
      boxShadow: '0 6px 18px rgba(0, 0, 0, 0.12)', fontSize: 13
    }}>
      <span style={{ flex: 1, fontWeight: 600 }}>Update available</span>
      <button type="button" onClick={() => setDismissed(available)}
        style={{ ...buttonStyle, background: 'transparent', color: 'inherit', fontWeight: 600 }}>Later</button>
      <button type="button" onClick={reloadNow}
        style={{ ...buttonStyle, background: 'var(--theme-accent, #B27A35)', color: '#FFFFFF' }}>Reload</button>
    </div>
  )
}
