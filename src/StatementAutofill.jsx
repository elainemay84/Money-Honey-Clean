import { useEffect, useRef, useState } from 'react'
import { getDebtTypes } from './debtData.js'
import { BILL_STATEMENT_FIELDS, STATEMENT_FIELDS, validateBillStatementSuggestions, validateStatementSuggestions } from './statementData.js'
import { extractBillStatement, extractDebtStatement } from './statementExtraction.js'

export default function StatementAutofill({
  currentValues, onApply, fieldStyle, buttonStyle, extract,
  initialOpen = false, onExtract, onManual, onClose, mode = 'debt'
}) {
  const fields = mode === 'bill' ? BILL_STATEMENT_FIELDS
    : STATEMENT_FIELDS.filter(field => !['totalInstallments', 'completedInstallments'].includes(field.key))
  const extractor = extract ?? (mode === 'bill' ? extractBillStatement : extractDebtStatement)
  const [open, setOpen] = useState(initialOpen)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [suggestions, setSuggestions] = useState(null)
  const [selected, setSelected] = useState({})
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(0)
  const [installments, setInstallments] = useState(null)
  const [warnings, setWarnings] = useState([])
  const camera = useRef(null)
  const photos = useRef(null)
  const pdf = useRef(null)
  const operation = useRef(null)
  const lastFile = useRef(null)

  useEffect(() => () => operation.current?.abort(), [])

  async function scan(file) {
    lastFile.current = file
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setSuggestions(null)
    setInstallments(null)
    setWarnings([])
    setApplied(0)
    setError('')
    setProgress('Preparing the on-device reader...')
    try {
      const result = await extractor(file, {
        signal: controller.signal,
        onProgress: text => { if (!controller.signal.aborted) setProgress(text) }
      })
      if (controller.signal.aborted) return
      lastFile.current = null
      if (onExtract) {
        onExtract(result)
        return
      }
      setSuggestions(result.values)
      setInstallments(result.installments ?? null)
      setWarnings(result.warnings ?? [])
      setSelected(Object.fromEntries(fields.filter(field => Object.hasOwn(result.values, field.key))
        .map(field => [field.key, true])))
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure.name === 'StatementScanError'
          ? failure.message
          : 'The statement could not be read. Try a clearer image or another PDF. No document was uploaded.')
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function readStatement(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) scan(file)
  }

  function cancel() {
    operation.current?.abort()
    setBusy(false)
    setSuggestions(null)
    setSelected({})
    setError('')
    setApplied(0)
    setOpen(false)
    lastFile.current = null
    onClose?.()
  }

  function apply() {
    try {
      const values = (mode === 'bill' ? validateBillStatementSuggestions : validateStatementSuggestions)(Object.fromEntries(
        Object.entries(suggestions).filter(([key]) => selected[key])
      ))
      const overwritten = fields.filter(({ key, type }) => {
        if (!Object.hasOwn(values, key)) return false
        const current = currentValues[key]
        if (current == null || String(current).trim() === '') return false
        return type === 'number' ? Number(current) !== Number(values[key]) : String(current) !== values[key]
      })
      const replacesPlan = installments?.length && currentValues.paymentSchedule?.installments?.length
      if ((overwritten.length || replacesPlan) && !window.confirm(
        `Replace existing form values for ${[...overwritten.map(field => field.label), ...(replacesPlan ? ['installment schedule'] : [])].join(', ')}? Nothing is saved until you save the ${mode}.`
      )) return
      onApply(values, { installments, warnings })
      setSuggestions(null)
      setSelected({})
      setError('')
      setApplied(Object.keys(values).length)
    } catch (failure) {
      setError(failure.message)
    }
  }

  const suggestedFields = fields.filter(field => suggestions && Object.hasOwn(suggestions, field.key))

  return (
    <section aria-label="Statement autofill" className="statement-autofill" style={{ minWidth: 0 }}>
      {!onExtract && <button type="button" onClick={() => setOpen(true)} style={{ ...buttonStyle, padding: '7px 10px', fontSize: 12 }}>
        Scan / Upload Statement
      </button>}
      {open && (
        <div className="statement-autofill-panel">
          <p id={onExtract ? 'statement-scan-description' : undefined} className="statement-scan-description">
            Add a photo or PDF to fill in your {mode} details.
          </p>
          <div className="statement-scan-choices">
            {[
              ['Take Photo', camera, <><path d="M8 5 9.5 3h5L16 5h4v15H4V5Z" /><circle cx="12" cy="12" r="3.5" /></>],
              ['Choose Image', photos, <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>],
              ['Choose PDF', pdf, <><path d="M14 3H5v18h14V8ZM14 3v5h5M8 13h8M8 17h6" /></>]
            ].map(([label, ref, icon]) => (
              <button key={label} type="button" className="statement-scan-choice" disabled={busy} onClick={() => ref.current.click()}>
                <svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
                <span>{label}</span>
                <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            ))}
          </div>
          <input ref={camera} aria-label="Statement camera photo" type="file" accept="image/*" capture="environment" onChange={readStatement} style={{ display: 'none' }} />
          <input ref={photos} aria-label="Statement image" type="file" accept="image/*" onChange={readStatement} style={{ display: 'none' }} />
          <input ref={pdf} aria-label="Statement PDF" type="file" accept=".pdf,application/pdf" onChange={readStatement} style={{ display: 'none' }} />
          <p className="statement-scan-privacy">Processed privately on your device &middot; 15 MB max</p>
          {busy && <p role="status">{progress}</p>}
          {error && <p role="alert" style={{ color: '#9B463E' }}>{error}</p>}
          {error && <p className="statement-scan-help">Try a clear English summary page, up to 5 PDF pages.</p>}
          {error && <button type="button" className="statement-scan-retry" onClick={() => { if (lastFile.current) scan(lastFile.current) }} style={{ ...buttonStyle, minHeight: 48 }}>Retry Reading</button>}
          {suggestions && <p role="status">{suggestedFields.length
            ? `We found ${suggestedFields.length} ${suggestedFields.length === 1 ? 'field' : 'fields'}. Review and complete the rest.`
            : 'We read text, but could not match any debt fields. You can enter them manually.'}</p>}
          {suggestedFields.length > 0 && (
            <div aria-label="Review statement suggestions" style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              <strong>Review extracted values</strong>
              {warnings.map(warning => <p key={warning} role="status">{warning}</p>)}
              {installments && <p>{installments.length} installment rows found. Apply to review and edit their dates, amounts, and paid statuses in the form.</p>}
              {suggestedFields.map(({ key, label, type }) => (
                <div key={key} style={{ display: 'grid', gap: 3 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input type="checkbox" aria-label={`Use ${label}`} checked={selected[key]} onChange={event => setSelected({ ...selected, [key]: event.target.checked })} />
                    {label}
                  </label>
                  {type === 'select' ? (
                    <select aria-label={`Scanned ${label}`} value={suggestions[key]} disabled={!selected[key]} onChange={event => setSuggestions({ ...suggestions, [key]: event.target.value })} style={fieldStyle}>
                      {getDebtTypes().map(value => <option key={value}>{value}</option>)}
                    </select>
                  ) : (
                    <input
                      aria-label={`Scanned ${label}`}
                      type={type === 'number' || type === 'integer' ? 'text' : type}
                      inputMode={type === 'number' ? 'decimal' : type === 'integer' || key === 'accountLast4' ? 'numeric' : undefined}
                      maxLength={key === 'accountLast4' ? 4 : undefined}
                      autoComplete="off"
                      value={suggestions[key]}
                      disabled={!selected[key]}
                      onChange={event => setSuggestions({ ...suggestions, [key]: event.target.value })}
                      style={fieldStyle}
                    />
                  )}
                </div>
              ))}
              <p style={{ margin: 0 }}>Uncheck suggestions you do not want. Existing payment history is never replaced.</p>
              <button type="button" onClick={apply} style={{ ...buttonStyle, fontWeight: 'bold' }}>Apply Suggestions to Form</button>
            </div>
          )}
          {applied > 0 && <p role="status">Statement scanned. Review your information before saving.</p>}
          <div className="statement-scan-footer">
            {onManual && <button type="button" onClick={() => { operation.current?.abort(); lastFile.current = null; onManual() }}>Enter Manually</button>}
            <button type="button" onClick={cancel}>{busy ? 'Cancel Reading' : onExtract ? 'Cancel' : 'Close Scanner'}</button>
          </div>
        </div>
      )}
    </section>
  )
}
