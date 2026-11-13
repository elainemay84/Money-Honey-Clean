import { useState } from 'react'
import { clearPendingOperation, getPendingOperation } from './profileData.js'

const LABELS = { reset: 'Reset App Data', delete: 'Delete Profile' }

// Shown only when a reset or delete started but never finished, so partial changes are never silent.
export default function PendingOperationNotice({ storage }) {
  const [pending, setPending] = useState(() => getPendingOperation(storage))
  if (!pending) return null

  function dismiss() {
    clearPendingOperation(storage)
    setPending(null)
  }

  return (
    <section
      role="alert"
      aria-label="Interrupted operation"
      style={{ maxWidth: 460, margin: '8px auto', padding: 12, borderRadius: 14, border: '2px solid #A12828', background: '#FFFFFF', color: '#A12828', fontSize: 12 }}
    >
      <strong style={{ display: 'block', marginBottom: 4 }}>
        {LABELS[pending.kind] ?? 'An earlier change'} did not finish.
      </strong>
      Some of your data may be missing. If something looks wrong, restore your latest backup under Settings &rarr; Backup &amp; Transfer.
      <button
        type="button"
        onClick={dismiss}
        style={{ display: 'block', marginTop: 8, padding: '7px 10px', border: '1px solid #A12828', borderRadius: 10, background: '#FFFFFF', color: '#A12828', fontWeight: 'bold', cursor: 'pointer' }}
      >
        Dismiss
      </button>
    </section>
  )
}
