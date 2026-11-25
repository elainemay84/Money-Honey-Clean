import { useMemo, useState } from 'react'
import FinancialInput from './FinancialInput'
import { createPaymentPlan, generatePaymentPlan, getInstallmentStatus, PAYMENT_FREQUENCY_OPTIONS, sortPaymentPlanInstallments, validatePaymentSchedule } from './debtSchedule.js'

export default function PaymentPlanFields({ rows: sourceRows, onChange, fieldStyle, labelStyle, paymentHistory = [], balance, hasBillHistory = false, allowGenerate = true }) {
  const rows = useMemo(() => sortPaymentPlanInstallments(sourceRows), [sourceRows])
  const [expanded, setExpanded] = useState(null)
  const [count, setCount] = useState('4')
  const [firstDate, setFirstDate] = useState('')
  const [frequency, setFrequency] = useState('biweekly')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const recorded = new Set(paymentHistory.filter(payment => !payment.reversedAt).map(payment => payment.installmentNumber))
  const canGenerate = allowGenerate && !paymentHistory.length && !hasBillHistory
  const visiblePreview = preview?.source === rows && preview.balance === balance ? preview.rows : null
  function change(index, changes) {
    onChange(sortPaymentPlanInstallments(rows.map((row, i) => i === index ? { ...row, ...changes } : row)))
  }
  function generate() {
    try {
      const retained = rows.filter(row => getInstallmentStatus(row) !== 'due')
      const firstNumber = Math.max(0, ...retained.map((row, index) => row.installmentNumber ?? index + 1))
      const generated = generatePaymentPlan(balance, count, firstDate, frequency).installments
        .map((row, index) => ({ ...row, installmentNumber: firstNumber + index + 1 }))
      const combined = sortPaymentPlanInstallments([...retained, ...generated])
      validatePaymentSchedule(createPaymentPlan(combined))
      setPreview({ source: rows, balance, rows: combined })
      setError('')
    } catch (failure) {
      setPreview(null)
      setError(failure.message)
    }
  }
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 8 }}>
      <legend>Installments</legend>
      {!rows.length && <p role="status" style={{ margin: 0, fontSize: 11 }}>Add installments or complete the schedule settings.</p>}
      {canGenerate && <details>
        <summary>Generate Schedule</summary>
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          <p style={{ margin: 0, fontSize: 11 }}>Divide the current remaining balance into payments. Using this schedule replaces due rows, including corrections; paid and pending statement rows are kept.</p>
          <label style={labelStyle}>Number of payments
            <input aria-label="Number of payments" type="number" min="1" max="600" value={count} style={fieldStyle}
              onChange={event => { setCount(event.target.value); setPreview(null) }} />
          </label>
          <label style={labelStyle}>First payment date
            <input aria-label="First payment date" type="date" value={firstDate} style={fieldStyle}
              onChange={event => { setFirstDate(event.target.value); setPreview(null) }} />
          </label>
          <label style={labelStyle}>Frequency
            <select aria-label="Generated schedule frequency" value={frequency} style={fieldStyle}
              onChange={event => { setFrequency(event.target.value); setPreview(null) }}>
              {PAYMENT_FREQUENCY_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <button type="button" onClick={generate}>Preview Schedule</button>
          {error && <p role="alert">{error}</p>}
          {visiblePreview && <div aria-label="Generated schedule preview">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {visiblePreview.map(row => <li key={row.installmentNumber}>
                {row.dueDate} - {Number(row.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}{row.paid ? ' - Paid on statement' : ''}
              </li>)}
            </ul>
            <button type="button" onClick={() => { onChange(visiblePreview); setPreview(null) }}>Use Generated Schedule</button>
          </div>}
        </div>
      </details>}
      {rows.map((row, index) => {
        const locked = recorded.has(row.installmentNumber)
        return (
          <details key={row.installmentNumber} className="payment-plan-row" open={expanded === row.installmentNumber}>
            <summary onClick={event => {
              event.preventDefault()
              setExpanded(current => current === row.installmentNumber ? null : row.installmentNumber)
            }}>
              <span className="payment-plan-row-date"><span className="payment-plan-row-number">Installment {index + 1} · </span>{row.dueDate || 'Missing date'}</span>
              <strong>{String(row.amount ?? '').trim() ? `$${row.amount}` : 'Missing amount'}</strong>
              <span className={`payment-plan-row-status status-${locked ? 'paid' : getInstallmentStatus(row)}`}>
                {locked || getInstallmentStatus(row) === 'paid' ? 'Paid' : getInstallmentStatus(row) === 'pending' ? 'Pending' : 'Due'}
              </span>
              <span className="payment-plan-row-chevron" aria-hidden="true">›</span>
            </summary>
            <div className="payment-plan-row-editor">
              <label style={labelStyle}>Due Date
                <input aria-label={`Installment ${index + 1} date`} type="date" value={row.dueDate} disabled={locked}
                  onChange={event => change(index, { dueDate: event.target.value })} style={fieldStyle} />
              </label>
              <label style={labelStyle}>Amount
                <FinancialInput aria-label={`Installment ${index + 1} amount`} value={row.amount} disabled={locked}
                  onChange={event => change(index, { amount: event.target.value })} style={fieldStyle} />
              </label>
              <label style={labelStyle}>Status
                <select aria-label={`Installment ${index + 1} status`} value={locked ? 'paid' : getInstallmentStatus(row)} disabled={locked}
                  style={fieldStyle}
                  onChange={event => change(index, { status: event.target.value, paid: event.target.value === 'paid' })}>
                  <option value="due">Due</option>
                  <option value="pending">Pending</option>
                  <option value="paid">{locked ? 'Paid in Accounts / Bills' : 'Paid on statement'}</option>
                </select>
              </label>
              <button type="button" className="payment-plan-remove" disabled={locked} onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove installment {index + 1}</button>
            </div>
          </details>
        )
      })}
      <button type="button" onClick={() => onChange(sortPaymentPlanInstallments([...rows, {
        dueDate: '', amount: '', paid: false,
        installmentNumber: Math.max(0, ...rows.map((row, index) => row.installmentNumber ?? index + 1)) + 1
      }]))}>Add installment</button>
    </fieldset>
  )
}
