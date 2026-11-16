import FinancialInput from './FinancialInput'

export default function PaymentPlanFields({ rows, onChange, fieldStyle, labelStyle, paymentHistory = [] }) {
  const recorded = new Set(paymentHistory.filter(payment => !payment.reversedAt).map(payment => payment.installmentNumber))
  function change(index, changes) {
    onChange(rows.map((row, i) => i === index ? { ...row, ...changes } : row))
  }
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 8 }}>
      <legend>Installments</legend>
      <p style={{ margin: 0, fontSize: 11 }}>Enter exact dates and amounts. Paid on statement is tracking only; no historical bank transactions are created.</p>
      {rows.map((row, index) => {
        const locked = recorded.has(row.installmentNumber)
        return (
          <div key={index} style={{ display: 'grid', gap: 4, paddingBottom: 8, borderBottom: '1px solid #E9D6B7' }}>
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
