import { useMemo, useState } from 'react'
import FinancialInput from './FinancialInput'
import { createPaymentPlan, generatePaymentPlan, PAYMENT_FREQUENCY_OPTIONS, sortPaymentPlanInstallments, validatePaymentSchedule } from './debtSchedule.js'

export default function PaymentPlanFields({ rows: sourceRows, onChange, fieldStyle, labelStyle, paymentHistory = [], balance, hasBillHistory = false }) {
  const rows = useMemo(() => sortPaymentPlanInstallments(sourceRows), [sourceRows])
  const [count, setCount] = useState('4')
  const [firstDate, setFirstDate] = useState('')
  const [frequency, setFrequency] = useState('biweekly')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const recorded = new Set(paymentHistory.filter(payment => !payment.reversedAt).map(payment => payment.installmentNumber))
  const canGenerate = !paymentHistory.length && !hasBillHistory
  const visiblePreview = preview?.source === rows && preview.balance === balance ? preview.rows : null
  function change(index, changes) {
    onChange(sortPaymentPlanInstallments(rows.map((row, i) => i === index ? { ...row, ...changes } : row)))
  }
  function generate() {
    try {
      const paid = rows.filter(row => row.paid)
      const firstNumber = Math.max(0, ...paid.map((row, index) => row.installmentNumber ?? index + 1))
      const generated = generatePaymentPlan(balance, count, firstDate, frequency).installments
        .map((row, index) => ({ ...row, installmentNumber: firstNumber + index + 1 }))
      const combined = sortPaymentPlanInstallments([...paid, ...generated])
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
      <p style={{ margin: 0, fontSize: 11 }}>Review scanned dates and amounts, or generate a schedule below. Complete any missing fields. Paid on statement is tracking only; no historical bank transactions are created.</p>
      {!rows.length && <p role="status" style={{ margin: 0, fontSize: 11 }}>No installment rows found. Generate a schedule or add the missing installments.</p>}
      {canGenerate && <details>
        <summary>Generate Schedule</summary>
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          <p style={{ margin: 0, fontSize: 11 }}>Divide the current remaining balance into payments. Using this schedule replaces unpaid rows, including corrections; paid statement rows are kept.</p>
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
          <div key={row.installmentNumber} style={{ display: 'grid', gap: 4, paddingBottom: 8, borderBottom: '1px solid #E9D6B7' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <label style={labelStyle}>Due date {index + 1}
                <input aria-label={`Installment ${index + 1} date`} type="date" value={row.dueDate} disabled={locked}
                  onChange={event => change(index, { dueDate: event.target.value })} style={fieldStyle} required />
              </label>
              <label style={labelStyle}>Amount {index + 1}
                <FinancialInput aria-label={`Installment ${index + 1} amount`} value={row.amount} disabled={locked}
                  onChange={event => change(index, { amount: event.target.value })} style={fieldStyle} required />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: 12 }}>
                <input type="checkbox" checked={row.paid || locked} disabled={locked}
                  onChange={event => change(index, { paid: event.target.checked })} />
                {locked ? 'Paid in Accounts / Bills' : 'Paid on statement'}
              </label>
              <button type="button" disabled={locked} onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove installment {index + 1}</button>
            </div>
          </div>
        )
      })}
      <button type="button" onClick={() => onChange([...rows, {
        dueDate: '', amount: '', paid: false,
        installmentNumber: Math.max(0, ...rows.map((row, index) => row.installmentNumber ?? index + 1)) + 1
      }])}>Add installment</button>
    </fieldset>
  )
}
