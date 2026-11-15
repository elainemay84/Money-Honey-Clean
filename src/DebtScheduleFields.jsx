import { defaultSchedule } from './debtSchedule.js'

const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const displayDate = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
})

export default function DebtScheduleFields({ value, onChange, nextDate, nextPayment, error, fieldStyle, labelStyle }) {
  const kind = value?.kind ?? 'monthly'
  const legacy = kind !== 'monthly' && kind !== 'pay-in-4'
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={labelStyle}>Payment Schedule
        <select aria-label="Payment Schedule" value={legacy ? '' : kind} style={fieldStyle} onChange={event => {
          const selected = event.target.value
          onChange(selected === 'monthly' ? defaultSchedule(nextDate) : {
            kind: 'pay-in-4', frequency: 'biweekly', startDate: nextDate,
            completedInstallments: 0, totalInstallments: 4, installmentAmount: null
          })
        }}>
          {legacy && <option value="" disabled hidden>Saved schedule (preserved)</option>}
          <option value="monthly">Monthly</option>
          <option value="pay-in-4">Pay in 4</option>
        </select>
      </label>
      {legacy && <p style={{ margin: 0, fontSize: 11, color: '#79502A' }}>Your existing schedule is kept unless you choose a replacement.</p>}
      {kind === 'pay-in-4' && <p style={{ margin: 0, fontSize: 11, color: '#79502A' }}>
        {nextPayment?.nextDueDate && nextPayment.nextPaymentAmount != null
          ? `Next scheduled payment: ${money(nextPayment.nextPaymentAmount)} · ${displayDate(nextPayment.nextDueDate)}`
          : error || (nextPayment ? 'No upcoming installments.' : 'Enter the current balance and first payment due date. Four payments, 14 days apart; any cent remainder is in the last payment.')}
      </p>}
    </div>
  )
}
