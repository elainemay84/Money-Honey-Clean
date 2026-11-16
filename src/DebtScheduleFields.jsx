import { createRecurringSchedule, PAYMENT_FREQUENCY_OPTIONS } from './debtSchedule.js'

const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const displayDate = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
})
const DAYS = Array.from({ length: 31 }, (_, index) => index + 1)

export default function DebtScheduleFields({ value, onChange, nextDate, nextPayment, error, fieldStyle, labelStyle }) {
  const frequency = value?.frequency ?? 'monthly'
  const finite = value?.totalInstallments != null && value.totalInstallments !== ''
  // Saved Pay in 4 and custom plans are preserved exactly unless the user picks a replacement frequency.
  const preserved = finite || !PAYMENT_FREQUENCY_OPTIONS.some(([key]) => key === frequency)
  const payInFour = value?.kind === 'pay-in-4'
  const noteStyle = { margin: 0, fontSize: 11, color: '#79502A' }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={labelStyle}>Payment Frequency
        <select aria-label="Payment Frequency" value={preserved ? (payInFour ? 'pay-in-4' : '') : frequency} style={fieldStyle}
          onChange={event => onChange(createRecurringSchedule(event.target.value, nextDate ?? ''))}>
          {preserved && (payInFour
            ? <option value="pay-in-4" disabled>Pay in 4 (saved plan)</option>
            : <option value="" disabled hidden>Saved schedule (preserved)</option>)}
          {PAYMENT_FREQUENCY_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {preserved && !payInFour && <p style={noteStyle}>Your existing schedule is kept unless you choose a replacement.</p>}
      {!preserved && frequency === 'twice-monthly' && (
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <legend style={{ ...noteStyle, padding: 0, marginBottom: 4 }}>Payment days · short months use their last day</legend>
          {[0, 1].map(index => (
            <select key={index} aria-label={index ? 'Second payment day' : 'First payment day'} style={fieldStyle}
              value={value.daysOfMonth?.[index] ?? ''}
              onChange={event => {
                const daysOfMonth = [...(value.daysOfMonth ?? [])]
                daysOfMonth[index] = Number(event.target.value)
                onChange({ ...value, daysOfMonth })
              }}>
              {DAYS.map(day => <option key={day} value={day}>{day === 31 ? '31 / last day' : day}</option>)}
            </select>
          ))}
        </fieldset>
      )}
      {payInFour && <p style={noteStyle}>
        {nextPayment?.nextDueDate && nextPayment.nextPaymentAmount != null
          ? `Next scheduled payment: ${money(nextPayment.nextPaymentAmount)} · ${displayDate(nextPayment.nextDueDate)}`
          : error || (nextPayment ? 'No upcoming installments.' : 'Enter the current balance and next payment due date.')}
      </p>}
      {!payInFour && !preserved && error && <p style={noteStyle}>{error}</p>}
    </div>
  )
}
