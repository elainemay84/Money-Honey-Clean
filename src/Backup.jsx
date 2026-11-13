import { useRef, useState } from 'react'
import {
  MAX_BACKUP_BYTES,
  downloadBackup,
  downloadSafetyBackup,
  getDataFingerprint,
  parseBackup,
  restoreBackup
} from './backupData.js'
import {
  clearRestoreNotice,
  hasRestoreNotice,
  markRestoreComplete
} from './backupRestoreNotice.js'
import PageHeader from './PageHeader'

const card = {
  background: '#FFFFFF',
  padding: 16,
  borderRadius: 16,
  marginBottom: 12,
  boxShadow: '0 3px 14px #76552212'
}

const button = {
  width: '100%',
  padding: '11px 14px',
  border: '1px solid #B87522',
  borderRadius: 10,
  background: '#B87522',
  color: '#FFFFFF',
  fontWeight: 'bold',
  cursor: 'pointer'
}

const ACTION_LABELS = {
  replace: 'Replaced',
  remove: 'Removed',
  add: 'Added',
  same: 'No change'
}

const ACTION_COLORS = {
  replace: '#8A5A00',
  remove: '#A12828',
  add: '#2F6B3A',
  same: '#79502A'
}

function formatExportDate(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'unknown date'
}

const compactButton = {
  ...button,
  padding: '9px 6px',
  fontSize: 12,
  minWidth: 0
}

const compactSecondaryButton = {
  ...compactButton,
  background: '#FFFFFF',
  color: '#B87522'
}

function DetailsList({ items, ignoredCount }) {
  return (
    <details style={{ margin: '0 0 10px', fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', color: '#79502A', fontWeight: 'bold' }}>View details</summary>
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
        {items.map(item => (
          <li key={item.id} data-action={item.action} style={{ padding: '5px 0', borderTop: '1px solid #EADBC8' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{item.label}</strong>
              <span style={{ color: ACTION_COLORS[item.action], fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                {ACTION_LABELS[item.action]}
              </span>
            </div>
            <div style={{ color: '#79502A' }}>
              {item.action === 'remove' && `Now: ${item.currentDetail}`}
              {item.action === 'add' && `Backup: ${item.backupDetail}`}
              {item.action === 'replace' && `${item.currentDetail} → ${item.backupDetail}`}
              {item.action === 'same' && item.currentDetail}
            </div>
          </li>
        ))}
      </ul>
      {ignoredCount > 0 && (
        <p style={{ margin: '6px 0 0', color: '#79502A' }}>
          {ignoredCount} unsupported item{ignoredCount === 1 ? '' : 's'} in the file will be skipped.
        </p>
      )}
    </details>
  )
}

export default function Backup({
  onBack,
  reload = () => window.location.reload(),
  storage = globalThis.localStorage,
  downloadSafety = downloadSafetyBackup,
  onHome,
  session
}) {
  const fileInput = useRef(null)
  const [pending, setPending] = useState(null)
  const [safety, setSafety] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('idle')
  const [restored, setRestored] = useState(() => hasRestoreNotice(session))
  const [needsReload, setNeedsReload] = useState(false)

  function clearSelection() {
    setPending(null)
    setSafety(null)
    setAcknowledged(false)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  function showError(message) {
    clearSelection()
    setError({ message, rollbackFailed: false })
  }

  async function chooseFile(event) {
    const file = event.target.files?.[0]
    clearSelection()
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) {
      setError({ message: 'This file is too large to be a Money Honey backup.' })
      return
    }
    try {
      const { backup, preview } = parseBackup(await file.text(), storage)
      setPending({ fileName: file.name, backup, preview })
    } catch (caught) {
      setError({ message: caught?.name === 'BackupImportError' ? caught.message : 'This file could not be read.' })
    }
  }

  function startSafetyDownload() {
    if (!pending) return
    try {
      if (getDataFingerprint(storage) !== pending.preview.currentFingerprint) {
        showError('Your data changed after the preview was created, so nothing was changed. Choose the backup file again.')
        return
      }
      setSafety(downloadSafety(storage))
      setError(null)
    } catch {
      setSafety(null)
      setError({ message: 'The safety backup download could not be started. Nothing was changed.' })
    }
  }

  function confirmImport() {
    const safetyReady = !pending?.preview.requiresSafetyBackup || safety
    if (!pending || status !== 'idle' || !safetyReady || !acknowledged) return
    setStatus('importing')
    try {
      restoreBackup(pending.backup, storage, {
        expectedFingerprint: safety?.fingerprint ?? pending.preview.currentFingerprint
      })
    } catch (caught) {
      const known = caught?.name === 'BackupImportError'
      setStatus('idle')
      setPending(null)
      setAcknowledged(false)
      setError({
        message: known ? caught.message : 'The import failed. Your existing data was kept unchanged.',
        rollbackFailed: known && caught.rollbackFailed,
        safetyFilename: safety?.filename
      })
      setSafety(null)
      return
    }
    // restoreBackup has read every restored value back, so the restore is verified at this point.
    setStatus('idle')
    setPending(null)
    setSafety(null)
    setAcknowledged(false)
    setRestored(true)
    if (markRestoreComplete(session)) reload()
    else setNeedsReload(true)
  }

  function finish() {
    clearRestoreNotice(session)
    if (needsReload) {
      reload()
      return
    }
    setRestored(false)
    onHome?.()
  }

  const items = pending?.preview.items ?? []
  const canRestore = pending && status === 'idle' && acknowledged && (!pending.preview.requiresSafetyBackup || safety)
  const inBackup = items.filter(item => item.backupDetail !== null)
  const accountSummary = inBackup.find(item => item.id === 'accounts')?.backupDetail ?? 'No accounts or transactions'
  const otherData = inBackup.filter(item => item.id !== 'accounts').map(item => item.label.toLowerCase())

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <PageHeader backLabel="Settings" onBack={onBack}>Backup &amp; Transfer</PageHeader>

      <section style={card}>
        <h2 style={{ margin: '0 0 7px', fontSize: 18 }}>Export Backup</h2>
        <p style={{ margin: '0 0 12px', color: '#79502A', fontSize: 12 }}>
          Download your Money Honey accounts, transactions, bills, income, debts, budgets, settings, themes, and saved preferences as a JSON backup.
        </p>
        <p style={{ margin: '0 0 12px', color: '#79502A', fontSize: 12 }}>
          This file contains financial information. Store it securely and do not share it publicly.
        </p>
        <button type="button" onClick={() => downloadBackup()} style={button}>
          Download Backup
        </button>
      </section>

      {restored ? (
        <section role="status" style={{ ...card, textAlign: 'center' }}>
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              margin: '0 auto 8px',
              borderRadius: '50%',
              background: '#2F6B3A',
              color: '#FFFFFF',
              fontSize: 22,
              lineHeight: '40px',
              fontWeight: 'bold'
            }}
          >
            ✓
          </div>
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Backup Restored!</h2>
          <p style={{ margin: '0 0 12px', color: '#79502A', fontSize: 13 }}>
            Your Money Honey data has been restored successfully.
          </p>
          <button type="button" onClick={finish} style={compactButton}>Back to Home</button>
        </section>
      ) : (
        <section style={card}>
          <h2 style={{ margin: '0 0 7px', fontSize: 18 }}>Import Backup</h2>
          <p style={{ margin: '0 0 10px', color: '#79502A', fontSize: 12 }}>
            Restore a Money Honey backup file. PINs and passwords are never imported.
          </p>

          <input
            id="backup-file"
            ref={fileInput}
            type="file"
            aria-label="Backup file"
            accept="application/json,.json"
            onChange={chooseFile}
            disabled={status === 'importing'}
            style={{ width: '100%', margin: '0 0 10px', fontSize: 12 }}
          />

          {error && !error.rollbackFailed && (
            <p role="alert" style={{ margin: '0 0 10px', color: '#A12828', fontSize: 13, fontWeight: 'bold' }}>
              {error.message}
            </p>
          )}

          {error?.rollbackFailed && (
            <div role="alert" aria-label="Recovery instructions" style={{ margin: '0 0 10px', padding: 12, border: '2px solid #A12828', borderRadius: 12, color: '#A12828', fontSize: 13 }}>
              <p style={{ margin: '0 0 8px', fontWeight: 'bold' }}>
                Warning: your previous data may not have been restored.
              </p>
              <p style={{ margin: '0 0 8px' }}>{error.message}</p>
              <ol style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                <li>Do not add or edit anything yet.</li>
                <li>Find the safety backup you downloaded{error.safetyFilename ? ` (${error.safetyFilename})` : ''}, or your most recent exported backup.</li>
                <li>Reload Money Honey, then choose that file under Import Backup to restore your data.</li>
                <li>If you cannot find a backup file, keep this browser tab and profile as they are and get help before clearing any browser data.</li>
              </ol>
              <button type="button" onClick={reload} style={compactSecondaryButton}>Reload Money Honey</button>
            </div>
          )}

          {pending && (
            <div aria-label="Backup preview">
              <div style={{ margin: '0 0 10px', padding: 12, borderRadius: 12, background: '#FFF8EE', border: '1px solid #EADBC8', fontSize: 13, textAlign: 'left' }}>
                <strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{pending.fileName}</strong>
                <span style={{ display: 'block', color: '#79502A', fontSize: 12 }}>
                  Exported {formatExportDate(pending.preview.exportedAt)}
                </span>
                <span style={{ display: 'block', margin: '6px 0 0' }}>{accountSummary}</span>
                {otherData.length > 0 && (
                  <span style={{ display: 'block', color: '#79502A', fontSize: 12 }}>
                    Also includes {otherData.join(', ')}.
                  </span>
                )}
              </div>

              <p style={{ margin: '0 0 10px', color: '#A12828', fontSize: 12, fontWeight: 'bold', textAlign: 'left' }}>
                Restoring this backup will replace your current Money Honey data, including accounts, transactions, bills, budgets, saved themes, and preferences. Anything not included in the backup may be removed.
              </p>

              <DetailsList items={items} ignoredCount={pending.preview.ignoredKeys.length} />

              {pending.preview.requiresSafetyBackup && (
                <div style={{ margin: '0 0 10px' }}>
                  <button type="button" onClick={startSafetyDownload} disabled={status !== 'idle'} style={compactSecondaryButton}>
                    Download Current Backup
                  </button>
                  {safety ? (
                    <p role="status" style={{ margin: '6px 0 0', color: '#79502A', fontSize: 11, overflowWrap: 'anywhere', textAlign: 'left' }}>
                      Download started: {safety.filename}. Check your Downloads folder; Money Honey cannot confirm it was saved.
                    </p>
                  ) : (
                    <p style={{ margin: '6px 0 0', color: '#79502A', fontSize: 11, textAlign: 'left' }}>
                      Required before you can restore.
                    </p>
                  )}
                </div>
              )}

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 10px', fontSize: 13, textAlign: 'left' }}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={event => setAcknowledged(event.target.checked)}
                  disabled={status !== 'idle'}
                />
                <span>I understand my current data will be replaced.</span>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={!canRestore}
                  style={{ ...compactButton, opacity: canRestore ? 1 : 0.5, cursor: canRestore ? 'pointer' : 'not-allowed' }}
                >
                  {status === 'importing' ? 'Restoring…' : 'Restore Backup'}
                </button>
                <button type="button" onClick={clearSelection} disabled={status === 'importing'} style={compactSecondaryButton}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
