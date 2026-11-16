import { parseFinancialAmount, parseInstallmentCount } from './financialAmounts.js'

export const DEBT_SCHEDULE_OPTIONS = [
  ['monthly', 'Monthly'], ['biweekly', 'Every 2 Weeks'], ['recurring', 'Recurring'], ['pay-in-4', 'Pay in 4'], ['custom', 'Custom'], ['payment-plan', 'Payment Plan']
]

export const PAYMENT_FREQUENCY_OPTIONS = [
  ['weekly', 'Weekly'], ['biweekly', 'Every 2 Weeks'], ['twice-monthly', 'Twice a Month'], ['monthly', 'Monthly'],
  ['quarterly', 'Every 3 Months'], ['semiannual', 'Every 6 Months'], ['annual', 'Annually']
]

const MONTH_STEPS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }
const DAY_STEPS = { weekly: 7, biweekly: 14 }

function clampedDate(year, monthIndex, day) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, monthIndex, Math.min(day, last)))
}

export function defaultTwiceMonthlyDays(date = '') {
  const day = isScheduleDate(date) ? Number(date.slice(-2)) : 1
  return day <= 15 ? [day, day + 15] : [day - 15, day]
}

export function createRecurringSchedule(frequency, startDate = '') {
  if (frequency === 'monthly') return defaultSchedule(startDate)
  return {
    kind: frequency === 'biweekly' ? 'biweekly' : 'recurring', frequency, startDate, dueDay: '',
    ...(frequency === 'twice-monthly' ? { daysOfMonth: defaultTwiceMonthlyDays(startDate) } : {}),
    completedInstallments: 0, totalInstallments: '', remainingTotal: '', installmentAmount: ''
  }
}

export function scheduleFromForm(schedule, nextDate) {
  if (schedule.kind === 'payment-plan') return createPaymentPlan(schedule.installments)
  const finite = schedule.totalInstallments !== '' && schedule.totalInstallments != null
  return {
    ...schedule,
    startDate: schedule.startDate || nextDate || '',
    dueDay: schedule.dueDay === '' || schedule.dueDay == null ? null : parseInstallmentCount(schedule.dueDay, 'Usual due day'),
    ...(schedule.frequency === 'twice-monthly'
      ? { daysOfMonth: (schedule.daysOfMonth ?? []).map(Number).sort((a, b) => a - b) }
      : {}),
    intervalDays: schedule.frequency === 'days' ? parseInstallmentCount(schedule.intervalDays, 'Interval') : null,
    totalInstallments: finite ? parseInstallmentCount(schedule.totalInstallments, 'Total installments') : null,
    completedInstallments: finite ? parseInstallmentCount(schedule.completedInstallments, 'Completed installments') : 0,
    remainingTotal: finite ? parseFinancialAmount(schedule.remainingTotal, 'Remaining scheduled repayment total') : null,
    installmentAmount: finite ? parseFinancialAmount(schedule.installmentAmount, 'Installment amount', { optional: true }) : null
  }
}

export function createPaymentPlan(installments = []) {
  const rows = installments.map((row, index) => ({
    scheduledDate: row.scheduledDate || row.dueDate,
    dueDate: row.dueDate,
    amount: parseFinancialAmount(row.amount, `Installment ${index + 1} amount`),
    paid: row.paid === true,
    installmentNumber: row.installmentNumber ?? index + 1
  }))
  return {
    kind: 'payment-plan', frequency: 'explicit',
    startDate: rows.map(row => row.scheduledDate).sort()[0] ?? '',
    totalInstallments: rows.length,
    completedInstallments: rows.filter(row => row.paid).length,
    remainingTotal: rows.filter(row => !row.paid).reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100,
    installments: rows
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

export function generatePaymentPlan(balance, paymentCount, firstDueDate, frequency = 'biweekly') {
  const remainingTotal = parseFinancialAmount(balance, 'Remaining balance')
  const count = parseInstallmentCount(paymentCount, 'Number of payments')
  if (count < 1 || count > 600) throw new Error('Choose 1 to 600 payments.')
  if (!isScheduleDate(firstDueDate)) throw new Error('Enter a valid first payment date.')
  if (!PAYMENT_FREQUENCY_OPTIONS.some(([key]) => key === frequency)) throw new Error('Choose a valid payment frequency.')
  const cents = Math.round(remainingTotal * 100)
  if (!Number.isSafeInteger(cents) || cents < count) throw new Error('Remaining balance must allow at least one cent per payment.')
  const schedule = createRecurringSchedule(frequency, firstDueDate)
  const regular = Math.floor(cents / count)
  const extra = cents % count
  const plan = createPaymentPlan(Array.from({ length: count }, (_, index) => ({
    dueDate: scheduledDate(schedule, index),
    amount: (regular + (index < extra ? 1 : 0)) / 100
  })))
  validatePaymentSchedule(plan)
  return plan
}

export function isScheduleDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validatePaymentSchedule(schedule) {
  if (schedule == null) return
  if (schedule.dateAdjustments != null) {
    if (!Array.isArray(schedule.dateAdjustments) || schedule.dateAdjustments.some(item =>
      !item || !isScheduleDate(item.scheduledDate) || !isScheduleDate(item.dueDate)
    ) || new Set(schedule.dateAdjustments.map(item => item.scheduledDate)).size !== schedule.dateAdjustments.length) {
      throw new Error('Upcoming date adjustments must contain valid, unique scheduled dates.')
    }
  }
  if (schedule.kind === 'payment-plan') {
    const rows = schedule.installments
    if (schedule.frequency !== 'explicit' || !Array.isArray(rows) || rows.length < 1 || rows.length > 600
      || rows.some(row => !row || !isScheduleDate(row.scheduledDate) || !isScheduleDate(row.dueDate)
        || !Number.isFinite(row.amount) || row.amount <= 0 || !Number.isSafeInteger(Math.round(row.amount * 100))
        || Math.abs(Math.round(row.amount * 100) / 100 - row.amount) > 0.000001
        || typeof row.paid !== 'boolean' || !Number.isInteger(row.installmentNumber)
        || row.installmentNumber < 1 || row.installmentNumber > 600)
      || new Set(rows.map(row => row.scheduledDate)).size !== rows.length
      || new Set(rows.map(row => row.installmentNumber)).size !== rows.length) {
      throw new Error('Enter 1 to 600 installments with unique dates, valid amounts, and paid statuses. Missing dates or amounts must be completed manually.')
    }
    const expected = createPaymentPlan(rows)
    if (!Number.isSafeInteger(rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0))
      || ['startDate', 'totalInstallments', 'completedInstallments', 'remainingTotal'].some(key => schedule[key] !== expected[key])) {
      throw new Error('Payment plan totals must match its installment rows.')
    }
    return
  }
  if (typeof schedule !== 'object' || Array.isArray(schedule)
    || !DEBT_SCHEDULE_OPTIONS.some(([key]) => key === schedule.kind)
    || ![...PAYMENT_FREQUENCY_OPTIONS.map(([key]) => key), 'days'].includes(schedule.frequency)) {
    throw new Error('Choose a valid payment schedule and frequency.')
  }
  if ((schedule.kind === 'monthly' && schedule.frequency !== 'monthly')
    || (schedule.kind === 'biweekly' && schedule.frequency !== 'biweekly')) {
    throw new Error('Use Custom for a different payment frequency.')
  }
  if (schedule.startDate && !isScheduleDate(schedule.startDate)) throw new Error('Choose a valid first upcoming payment date.')
  if (schedule.frequency === 'twice-monthly') {
    const days = schedule.daysOfMonth
    if (!Array.isArray(days) || days.length !== 2 || days.some(day => !Number.isInteger(day) || day < 1 || day > 31) || days[0] === days[1]) {
      throw new Error('Choose two different payment days between 1 and 31.')
    }
    if (schedule.startDate) {
      const start = new Date(`${schedule.startDate}T00:00:00Z`)
      if (!days.some(day => clampedDate(start.getUTCFullYear(), start.getUTCMonth(), day).getUTCDate() === start.getUTCDate())) {
        throw new Error('Next Payment Due must fall on one of the two payment days.')
      }
    }
  }
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
}

function twiceMonthlyDate(schedule, index) {
  const start = new Date(`${schedule.startDate}T00:00:00Z`)
  const days = [...schedule.daysOfMonth].sort((a, b) => a - b)
  let found = -1
  for (let month = 0; month <= index + 2; month += 1) {
    const dates = [...new Set(days.map(day =>
      clampedDate(start.getUTCFullYear(), start.getUTCMonth() + month, day).getTime()))]
    for (const time of dates) {
      if (time < start.getTime()) continue
      found += 1
      if (found === index) return new Date(time)
    }
  }
  return start
}

function scheduledDate(schedule, index) {
  const date = new Date(`${schedule.startDate}T00:00:00Z`)
  if (MONTH_STEPS[schedule.frequency]) {
    // Calendar periods: later months use the usual due day, clamped to shorter months.
    const day = index === 0 ? date.getUTCDate() : schedule.dueDay ?? date.getUTCDate()
    date.setTime(clampedDate(date.getUTCFullYear(), date.getUTCMonth() + MONTH_STEPS[schedule.frequency] * index, day).getTime())
  } else if (schedule.frequency === 'twice-monthly') {
    date.setTime(twiceMonthlyDate(schedule, index).getTime())
  } else {
    date.setUTCDate(date.getUTCDate() + (DAY_STEPS[schedule.frequency] ?? schedule.intervalDays) * index)
  }
  return date.toISOString().slice(0, 10)
}

export function getDebtScheduledPayments(debt, limit = 12) {
  const schedule = debt.paymentSchedule
  if (schedule?.kind === 'payment-plan') return schedule.installments.filter(row => !row.paid)
    .map(row => ({ ...row, dueDate: schedule.dateAdjustments?.find(item => item.scheduledDate === row.scheduledDate)?.dueDate ?? row.dueDate }))
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
  if (schedule.kind === 'payment-plan') {
    const paid = getPaidInstallmentNumbers(debt)
    const completed = schedule.installments.filter(row => row.paid || paid.has(row.installmentNumber)).length
    return { completed, total: schedule.installments.length, remaining: schedule.installments.length - completed }
  }
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

