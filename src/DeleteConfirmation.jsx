import { useState } from 'react'
import {
  CONFIRMATION_CODE_LENGTH,
  DELETE_ACTIONS,
  isConfirmationMatch,
  nextConfirmationCode,
  sanitizeCodeInput
} from './deleteCodeData.js'
import { downloadSafetyBackup } from './backupData.js'
import PageHeader from './PageHeader'
import {
  clearProfileActionNotice,
  getProfileActionNotice,
  markProfileActionComplete
} from './profileActionNotice.js'
import { performProfileAction } from './profileData.js'

const card = {
  background: '#FFFFFF',
  padding: 16,
  borderRadius: 16,
  marginBottom: 12,
  boxShadow: '0 3px 14px #76552212',
  color: '#493320'
}

const button = {
  width: '100%',
  minWidth: 0,
  padding: '10px 8px',
  border: '1px solid #B87522',
  borderRadius: 10,
  background: '#B87522',
  color: '#FFFFFF',
  fontSize: 13,
  fontWeight: 'bold',
  cursor: 'pointer'
}

const secondaryButton = { ...button, background: '#FFFFFF', color: '#B87522' }
const dangerButton = { ...button, border: '1px solid #A12828', background: '#A12828' }

function createCode(previous, generate) {
  try {
    return nextConfirmationCode(previous, generate)
  } catch {
    return null
  }
}

function List({ title, items, color }) {
  return (
    <div style={{ margin: '0 0 8px' }}>
      <strong style={{ display: 'block', color, fontSize: 12 }}>{title}</strong>
      <ul style={{ margin: '2px 0 0', paddingLeft: 18, fontSize: 12 }}>
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    </div>
  )
}

export default function DeleteConfirmation({
  kind,
  onBack,
  onConfirm = performProfileAction,
  generateCode,
  reload = () => window.location.reload(),
  downloadBackup = downloadSafetyBackup
}) {
  const action = DELETE_ACTIONS[kind]
  const [finished] = useState(() => getProfileActionNotice() === kind)
  const [code, setCode] = useState(() => (finished ? null : createCode(null, generateCode)))
  const [typed, setTyped] = useState('')
  const [stage, setStage] = useState(finished ? 'done' : 'code')
  const [backup, setBackup] = useState(null)
  const [backupError, setBackupError] = useState(false)
  const [failure, setFailure] = useState(null)
  const [needsReload, setNeedsReload] = useState(false)

  if (!action) return null

  const matches = isConfirmationMatch(typed, code)

  function leave() {
    clearProfileActionNotice()
    onBack()
  }

  function restart() {
    setCode(createCode(code, generateCode))
    setTyped('')
    setStage('code')
  }

  function startBackupDownload() {
    try {
      setBackup(downloadBackup())
      setBackupError(false)
    } catch {
      setBackup(null)
      setBackupError(true)
    }
  }

  function submitCode(event) {
    event.preventDefault()
    if (stage === 'code' && isConfirmationMatch(typed, code)) setStage('final')
  }

  function confirmFinal() {
    if (stage !== 'final' || !isConfirmationMatch(typed, code)) return
    try {
      onConfirm(kind)
    } catch (error) {
      setFailure({
        message: error?.name === 'ProfileActionError'
          ? error.message
          : 'The change failed. Nothing was deleted and your data is unchanged.',
        rollbackFailed: error?.rollbackFailed === true
      })
      setStage('failed')
      return
    }
    // The change is written and verified, so reload to drop any stale on-screen data.
    setStage('done')
    if (markProfileActionComplete(kind)) reload()
    else setNeedsReload(true)
  }

  const backupBlock = (
    <div style={{ margin: '0 0 10px' }}>
      <button type="button" onClick={startBackupDownload} style={secondaryButton}>Download Backup</button>
      {backup && (
        <p role="status" style={{ margin: '6px 0 0', color: '#79502A', fontSize: 11, overflowWrap: 'anywhere' }}>
          Download started: {backup.filename}. Check your Downloads folder; Money Honey cannot confirm it was saved.
        </p>
      )}
      {backupError && (
        <p role="alert" style={{ margin: '6px 0 0', color: '#A12828', fontSize: 11 }}>
          The backup download could not be started. Nothing was changed.
        </p>
      )}
      {!backup && !backupError && (
        <p style={{ margin: '6px 0 0', color: '#79502A', fontSize: 11 }}>Recommended: save a backup first.</p>
      )}
    </div>
  )

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <PageHeader className="page-header-full-title" backLabel="Settings" onBack={leave}>{action.title}</PageHeader>

      {stage === 'code' && code === null && (
        <section style={card}>
          <p role="alert" style={{ margin: '0 0 10px', color: '#A12828', fontSize: 13, fontWeight: 'bold' }}>
            A confirmation code could not be created on this device, so nothing can be deleted. Your data was not changed.
          </p>
          <button type="button" onClick={onBack} style={secondaryButton}>Back</button>
        </section>
      )}

      {stage === 'code' && code !== null && (
        <form onSubmit={submitCode} style={card} aria-label={`${action.title} confirmation`}>
          <div role="alert">
            <List title="Will be removed" items={action.removes} color="#A12828" />
            <List title="Will stay" items={action.keeps} color="#2F6B3A" />
            <p style={{ margin: '0 0 10px', color: '#A12828', fontSize: 12, fontWeight: 'bold' }}>{action.note}</p>
          </div>
          {backupBlock}
          <p style={{ margin: '0 0 4px', color: '#79502A', fontSize: 12 }}>Your confirmation code:</p>
          <p
            aria-label="Confirmation code"
            style={{ margin: '0 0 10px', fontSize: 34, fontWeight: 'bold', letterSpacing: 8, fontFamily: 'monospace', textAlign: 'center' }}
          >
            {code}
          </p>
          <label htmlFor="delete-confirmation-code" style={{ display: 'block', margin: '0 0 4px', fontSize: 12, fontWeight: 'bold' }}>
            Type the code to continue
          </label>
          <input
            id="delete-confirmation-code"
            value={typed}
            onChange={event => setTyped(sanitizeCodeInput(event.target.value))}
            inputMode="numeric"
            autoComplete="off"
            maxLength={CONFIRMATION_CODE_LENGTH}
            style={{ width: '100%', boxSizing: 'border-box', margin: '0 0 10px', padding: 10, border: '1px solid #E9D6B7', borderRadius: 10, fontSize: 18, letterSpacing: 6, textAlign: 'center' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="submit"
              disabled={!matches}
              style={{ ...dangerButton, opacity: matches ? 1 : 0.5, cursor: matches ? 'pointer' : 'not-allowed' }}
            >
              Continue
            </button>
            <button type="button" onClick={onBack} style={secondaryButton}>Cancel</button>
          </div>
        </form>
      )}

      {stage === 'final' && (
        <section style={card} aria-label="Final confirmation">
          <p role="alert" style={{ margin: '0 0 10px', color: '#A12828', fontSize: 13, fontWeight: 'bold' }}>
            Final confirmation: {action.finalSummary} {action.note}
          </p>
          {backupBlock}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" onClick={confirmFinal} style={dangerButton}>{action.finalButton}</button>
            <button type="button" onClick={restart} style={secondaryButton}>Go Back</button>
          </div>
        </section>
      )}

      {stage === 'failed' && failure && !failure.rollbackFailed && (
        <section style={card}>
          <p role="alert" style={{ margin: '0 0 10px', color: '#A12828', fontSize: 13, fontWeight: 'bold' }}>
            {failure.message}
          </p>
          <button type="button" onClick={onBack} style={secondaryButton}>Back to Settings</button>
        </section>
      )}

      {stage === 'failed' && failure?.rollbackFailed && (
        <section aria-label="Recovery instructions" role="alert" style={{ ...card, border: '2px solid #A12828', color: '#A12828', fontSize: 13 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 'bold' }}>
            Warning: some of your data may have been changed or removed.
          </p>
          <p style={{ margin: '0 0 8px' }}>{failure.message}</p>
          <ol style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            <li>Do not add or edit anything yet.</li>
            <li>Find the backup you downloaded{backup ? ` (${backup.filename})` : ''}, or your most recent exported backup.</li>
            <li>Reload Money Honey, then choose that file under Settings &rarr; Backup &amp; Transfer &rarr; Import Backup.</li>
            <li>If you have no backup file, keep this browser tab and profile as they are and get help before clearing any browser data.</li>
          </ol>
          <button type="button" onClick={reload} style={secondaryButton}>Reload Money Honey</button>
        </section>
      )}

      {stage === 'done' && (
        <section role="status" style={{ ...card, textAlign: 'center' }}>
          <div
            aria-hidden="true"
            style={{ width: 40, height: 40, margin: '0 auto 8px', borderRadius: '50%', background: '#2F6B3A', color: '#FFFFFF', fontSize: 22, lineHeight: '40px', fontWeight: 'bold' }}
          >
            ✓
          </div>
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>{action.doneTitle}</h2>
          <p style={{ margin: '0 0 12px', color: '#79502A', fontSize: 13 }}>{action.doneMessage}</p>
          <button type="button" onClick={needsReload ? reload : leave} style={button}>
            {needsReload ? 'Reload Money Honey' : 'Back to Settings'}
          </button>
        </section>
      )}
    </main>
  )
}
