import { useEffect, useRef, useState } from 'react'
import { getDebtTypes } from './debtData.js'
import { DEBT_STATEMENT_FIELDS, validateStatementSuggestions } from './statementData.js'
import { extractDebtStatement } from './statementExtraction.js'

export default function StatementAutofill({
  currentValues, onApply, fieldStyle, buttonStyle, extract = extractDebtStatement,
  initialOpen = false, onExtract, onManual, onClose
}) {
  const [open, setOpen] = useState(initialOpen)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [suggestions, setSuggestions] = useState(null)
  const [selected, setSelected] = useState({})
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(0)
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
    setApplied(0)
    setError('')
    setWarnings([])
    setProgress('Preparing the on-device reader...')
    try {
      const result = await extract(file, {
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
      setWarnings(result.warnings ?? [])
      setSelected(Object.fromEntries(DEBT_STATEMENT_FIELDS.filter(field => Object.hasOwn(result.values, field.key))
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
      const values = validateStatementSuggestions(Object.fromEntries(
        Object.entries(suggestions).filter(([key]) => selected[key])
      ))
      const overwritten = DEBT_STATEMENT_FIELDS.filter(({ key, type }) => {
        if (!Object.hasOwn(values, key)) return false
        const current = currentValues[key]
        if (current == null || String(current).trim() === '') return false
        return type === 'number' ? Number(current) !== Number(values[key]) : String(current) !== values[key]
      })
      if (overwritten.length && !window.confirm(
        `Replace existing form values for ${overwritten.map(field => field.label).join(', ')}? Nothing is saved until you save the debt.`
      )) return
      onApply(values)
      setSuggestions(null)
      setSelected({})
      setError('')
      setApplied(Object.keys(values).length)
    } catch (failure) {
      setError(failure.message)
    }
  }

  const suggestedFields = DEBT_STATEMENT_FIELDS.filter(field => suggestions && Object.hasOwn(suggestions, field.key))

  return (
    <section aria-label="Statement autofill" style={{ minWidth: 0 }}>
      {!onExtract && <button type="button" onClick={() => setOpen(true)} style={{ ...buttonStyle, padding: '7px 10px', fontSize: 12 }}>
        Scan / Upload Statement
      </button>}
      {open && (
        <div style={{ marginTop: 7, padding: 10, border: '1px solid #E9D6B7', borderRadius: 10, background: '#FFFFFF', color: '#79502A', fontSize: 11 }}>
          <p style={{ margin: '0 0 7px' }}>
            Read on this device only. Use a clear English summary page. Up to 15 MB / 5 PDF pages.
            Review suggestions before applying; nothing is saved automatically.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {[
              ['Take Photo', camera],
              ['Choose Image', photos],
              ['Choose PDF', pdf]
            ].map(([label, ref]) => (
              <button key={label} type="button" disabled={busy} onClick={() => ref.current.click()} style={{ ...buttonStyle, padding: '6px 8px', fontSize: 11 }}>{label}</button>
            ))}
          </div>
          <input ref={camera} aria-label="Statement camera photo" type="file" accept="image/*" capture="environment" onChange={readStatement} style={{ display: 'none' }} />
          <input ref={photos} aria-label="Statement image" type="file" accept="image/*" onChange={readStatement} style={{ display: 'none' }} />
          <input ref={pdf} aria-label="Statement PDF" type="file" accept=".pdf,application/pdf" onChange={readStatement} style={{ display: 'none' }} />
          {busy && <p role="status">{progress}</p>}
          {error && <p role="alert" style={{ color: '#9B463E' }}>{error}</p>}
          {error && <button type="button" onClick={() => { if (lastFile.current) scan(lastFile.current) }} style={buttonStyle}>Retry Reading</button>}
          {warnings.length > 0 && <p role="status">Some statement totals differ. Check the provider's figures before saving.</p>}
          {suggestions && <p role="status">{suggestedFields.length
            ? `We found ${suggestedFields.length} ${suggestedFields.length === 1 ? 'field' : 'fields'}. Review and complete the rest.`
            : 'We read text, but could not match any debt fields. You can enter them manually.'}</p>}
          {suggestedFields.length > 0 && (
            <div aria-label="Review statement suggestions" style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              <strong>Review extracted values</strong>
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
              <p style={{ margin: 0 }}>Uncheck suggestions you do not want. Historical starting balances and payment history are never scanned or replaced.</p>
              <button type="button" onClick={apply} style={{ ...buttonStyle, fontWeight: 'bold' }}>Apply Suggestions to Form</button>
            </div>
          )}
          {applied > 0 && <p role="status">We filled in {applied} {applied === 1 ? 'field' : 'fields'}. Review and complete the rest.</p>}
          {onManual && <button type="button" onClick={() => { operation.current?.abort(); lastFile.current = null; onManual() }} style={{ ...buttonStyle, marginTop: 7 }}>Enter Manually</button>}
          <button type="button" onClick={cancel} style={{ ...buttonStyle, marginTop: 7, padding: '5px 8px', fontSize: 11 }}>{busy ? 'Cancel Reading' : 'Close Scanner'}</button>
        </div>
      )}
    </section>
  )
}
