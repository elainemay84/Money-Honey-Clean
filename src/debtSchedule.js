import { parseFinancialAmount, parseInstallmentCount } from './financialAmounts.js'

export const DEBT_SCHEDULE_OPTIONS = [
  ['monthly', 'Monthly'], ['biweekly', 'Every 2 Weeks'], ['pay-in-4', 'Pay in 4'], ['custom', 'Custom']
]

export function scheduleFromForm(schedule, nextDate) {
  const finite = schedule.totalInstallments !== '' && schedule.totalInstallments != null
  return {
    ...schedule,
    startDate: schedule.startDate || nextDate || '',
    dueDay: schedule.dueDay === '' || schedule.dueDay == null ? null : parseInstallmentCount(schedule.dueDay, 'Usual due day'),
    intervalDays: schedule.frequency === 'days' ? parseInstallmentCount(schedule.intervalDays, 'Interval') : null,
    totalInstallments: finite ? parseInstallmentCount(schedule.totalInstallments, 'Total installments') : null,
    completedInstallments: finite ? parseInstallmentCount(schedule.completedInstallments, 'Completed installments') : 0,
    remainingTotal: finite ? parseFinancialAmount(schedule.remainingTotal, 'Remaining scheduled repayment total') : null,
    installmentAmount: finite ? parseFinancialAmount(schedule.installmentAmount, 'Installment amount', { optional: true }) : null
  }
}

export function defaultSchedule(date = '') {
  return { kind: 'monthly', frequency: 'monthly', startDate: date, dueDay: date ? Number(date.slice(-2)) : '', completedInstallments: 0, totalInstallments: '', remainingTotal: '', installmentAmount: '' }
}

export function createPayInFourSchedule(balance, firstDueDate) {
  const remainingTotal = parseFinancialAmount(balance, 'Current balance')
  if (!isScheduleDate(firstDueDate)) throw new Error('Enter a valid first payment due date.')
  if (Math.round(remainingTotal * 100) < 4) throw new Error('Current balance must be at least $0.04 for four payments.')
  return {
    kind: 'pay-in-4', frequency: 'biweekly', startDate: firstDueDate,
    totalInstallments: 4, completedInstallments: 0, remainingTotal, installmentAmount: null
  }
}

export function isScheduleDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validatePaymentSchedule(schedule) {
  if (schedule == null) return
  if (typeof schedule !== 'object' || Array.isArray(schedule)
    || !DEBT_SCHEDULE_OPTIONS.some(([key]) => key === schedule.kind)
    || !['monthly', 'biweekly', 'weekly', 'days'].includes(schedule.frequency)) {
    throw new Error('Choose a valid payment schedule and frequency.')
  }
  if ((schedule.kind === 'monthly' && schedule.frequency !== 'monthly')
    || (schedule.kind === 'biweekly' && schedule.frequency !== 'biweekly')) {
    throw new Error('Use Custom for a different payment frequency.')
  }
  if (schedule.startDate && !isScheduleDate(schedule.startDate)) throw new Error('Choose a valid first upcoming payment date.')
  if (schedule.dueDay != null && (!Number.isInteger(schedule.dueDay) || schedule.dueDay < 1 || schedule.dueDay > 31)) {
    throw new Error('The usual due day must be between 1 and 31.')
  }
  if (schedule.frequency === 'days' && (!Number.isInteger(schedule.intervalDays) || schedule.intervalDays < 1 || schedule.intervalDays > 366)) {
    throw new Error('The payment interval must be between 1 and 366 days.')
  }
  if (!Number.isInteger(schedule.completedInstallments) || schedule.completedInstallments < 0) {
    throw new Error('Completed installments must be a whole number, zero or more.')
  }
  if (schedule.totalInstallments != null) {
    if (!Number.isInteger(schedule.totalInstallments) || schedule.totalInstallments < 1 || schedule.totalInstallments > 600
      || schedule.completedInstallments > schedule.totalInstallments) {
      throw new Error('Enter 1 to 600 total installments and no more completed installments than the total.')
    }
    if (schedule.kind === 'pay-in-4' && schedule.totalInstallments !== 4) throw new Error('Pay in 4 requires four installments; use Custom for other plans.')
    const remaining = schedule.totalInstallments - schedule.completedInstallments
    const cents = Math.round(schedule.remainingTotal * 100)
    if (!Number.isFinite(schedule.remainingTotal) || schedule.remainingTotal < 0 || !Number.isSafeInteger(cents)
      || Math.abs(cents / 100 - schedule.remainingTotal) > 0.000001) {
      throw new Error('Enter the remaining scheduled repayment total to the nearest cent.')
    }
    if (remaining && (!isScheduleDate(schedule.startDate) || cents < remaining)) {
      throw new Error('Enter a first upcoming date and at least one cent per remaining installment.')
    }
    if (!remaining && cents !== 0) throw new Error('A fully completed plan must have no remaining scheduled repayment total.')
    if (schedule.installmentAmount != null && (!Number.isFinite(schedule.installmentAmount) || schedule.installmentAmount <= 0
      || Math.abs(Math.round(schedule.installmentAmount * 100) / 100 - schedule.installmentAmount) > 0.000001
      || (remaining && cents - Math.round(schedule.installmentAmount * 100) * (remaining - 1) <= 0))) {
      throw new Error('Enter a valid installment amount; the final installment must remain positive.')
    }
  } else if (schedule.kind === 'pay-in-4' || schedule.completedInstallments !== 0) {
    throw new Error('Enter the total number of installments for this plan.')
  }
  if (schedule.dateAdjustments != null) {
    if (!Array.isArray(schedule.dateAdjustments) || schedule.dateAdjustments.some(item =>
      !item || !isScheduleDate(item.scheduledDate) || !isScheduleDate(item.dueDate)
    ) || new Set(schedule.dateAdjustments.map(item => item.scheduledDate)).size !== schedule.dateAdjustments.length) {
      throw new Error('Upcoming date adjustments must contain valid, unique scheduled dates.')
    }
  }
}

function scheduledDate(schedule, index) {
  const date = new Date(`${schedule.startDate}T00:00:00Z`)
  if (schedule.frequency === 'monthly') {
    const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + index, 1))
    const day = index === 0 ? date.getUTCDate() : schedule.dueDay ?? date.getUTCDate()
    const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate()
    date.setTime(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(day, last)))
  } else {
    const interval = schedule.frequency === 'biweekly' ? 14 : schedule.frequency === 'weekly' ? 7 : schedule.intervalDays
    date.setUTCDate(date.getUTCDate() + interval * index)
  }
  return date.toISOString().slice(0, 10)
}

export function getDebtScheduledPayments(debt, limit = 12) {
  const schedule = debt.paymentSchedule
  if (!schedule || !isScheduleDate(schedule.startDate)) return []
  const finite = schedule.totalInstallments != null
  const count = finite ? schedule.totalInstallments - schedule.completedInstallments : limit
  const cents = finite ? Math.round(schedule.remainingTotal * 100) : 0
  const regular = finite
    ? schedule.installmentAmount == null ? Math.floor(cents / count) : Math.round(schedule.installmentAmount * 100)
    : Math.round((debt.minimumPayment ?? 0) * 100)
  return Array.from({ length: count }, (_, index) => {
    const date = scheduledDate(schedule, index)
    return {
      scheduledDate: date,
      dueDate: schedule.dateAdjustments?.find(item => item.scheduledDate === date)?.dueDate ?? date,
      amount: (finite && index === count - 1 ? cents - regular * (count - 1) : regular) / 100,
      installmentNumber: finite ? Number(schedule.completedInstallments) + index + 1 : null
    }
  })
}

export function getDebtInstallmentProgress(debt) {
  const schedule = debt.paymentSchedule
  if (schedule?.totalInstallments == null) return null
  const recorded = [...getPaidInstallmentNumbers(debt)]
    .filter(number => number > Number(schedule.completedInstallments) && number <= Number(schedule.totalInstallments)).length
  const completed = Number(schedule.completedInstallments) + recorded
  return { completed, total: schedule.totalInstallments, remaining: schedule.totalInstallments - completed }
}

export function getPaidInstallmentNumbers(debt) {
  const slots = getDebtScheduledPayments(debt)
  return new Set((debt.paymentHistory ?? []).filter(payment => !payment.reversedAt)
    .map(payment => payment.installmentNumber ?? slots.find(item => item.scheduledDate === payment.scheduledDueDate)?.installmentNumber)
    .filter(Number.isInteger))
}

export function getNextScheduledDebtPayment(debt) {
  const paid = new Set((debt.paymentHistory ?? []).filter(payment => !payment.reversedAt).map(payment => payment.scheduledDueDate))
  const numbers = debt.paymentSchedule?.totalInstallments != null ? getPaidInstallmentNumbers(debt) : new Set()
  return getDebtScheduledPayments(debt, (debt.paymentHistory?.length ?? 0) + 2)
    .filter(item => !paid.has(item.scheduledDate) && !numbers.has(item.installmentNumber))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null
}

