import { getLinkedOccurrenceTransaction } from './accountStorage.js'
import { getDefaultCategoryForFlow } from './categoryData.js'

export const BILL_STORAGE_KEY = 'money-honey-bills'
export const BILL_STORAGE_VERSION = 1
export const PAY_SCHEDULE_STORAGE_KEY = 'money-honey-pay-schedule'
export const PAY_SCHEDULE_STORAGE_VERSION = 1
export const INCOME_FREQUENCIES = [
  'one-time',
  'weekly',
  'biweekly',
  'twice-monthly',
  'monthly',
  'quarterly',
  'yearly'
]

const DAY_MS = 24 * 60 * 60 * 1000
const PAY_INTERVAL_DAYS = { weekly: 7, biweekly: 14 }

export function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isIncomeOccurrenceReceived(occurrence) {
  if (!Object.hasOwn(occurrence, 'linkedTransaction')) return occurrence.status === 'received'
  const transaction = occurrence.linkedTransaction
  return Boolean(
    transaction
    && transaction.amount === Math.abs(occurrence.amount)
    && transaction.accountId === occurrence.accountId
    && transaction.name === occurrence.name
  )
}

export function isBillOccurrencePaid(bill) {
  if (!Object.hasOwn(bill, 'linkedTransaction')) return Boolean(bill.paid)
  const transaction = bill.linkedTransaction
  return Boolean(
    transaction
    && transaction.amount === -Math.abs(bill.amount)
    && transaction.accountId === bill.accountId
    && transaction.name === bill.name
  )
}

function isBillOccurrenceCleared(bill) {
  if (!Object.hasOwn(bill, 'linkedTransaction')) return Boolean(bill.cleared)
  return isBillOccurrencePaid(bill) && bill.linkedTransaction.cleared
}

export function getTodayDate() {
  return formatLocalDate(new Date())
}

function dateFromParts(year, monthIndex, day) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, monthIndex, Math.min(day, lastDay)))
}

function formatUTCDate(date) {
  return date.toISOString().slice(0, 10)
}

function isDueInMonth(bill, year, monthIndex, candidate) {
  const anchor = new Date(`${bill.dueDate}T00:00:00Z`)
  const anchorYear = anchor.getUTCFullYear()
  const anchorMonth = anchor.getUTCMonth()
  const anchorDay = anchor.getUTCDate()
  const monthOffset = (year - anchorYear) * 12 + monthIndex - anchorMonth
  const dayOffset = (candidate.getTime() - anchor.getTime()) / DAY_MS
  const candidateDate = formatUTCDate(candidate)

  if (
    monthOffset < 0
    || dayOffset < 0
    || (bill.endDate && candidateDate > bill.endDate)
  ) return false

  switch (bill.frequency) {
    case 'one-time':
      return dayOffset === 0
    case 'weekly':
      return dayOffset % 7 === 0
    case 'biweekly':
      return dayOffset % 14 === 0
    case 'twice-monthly': {
      const days = [...new Set((bill.daysOfMonth ?? []).map(day =>
        dateFromParts(year, monthIndex, day).getUTCDate()
      ))]
      return days.includes(candidate.getUTCDate())
    }
    case 'monthly':
      return candidate.getUTCDate() === dateFromParts(year, monthIndex, anchorDay).getUTCDate()
    case 'quarterly':
      return monthOffset % 3 === 0 && candidate.getUTCDate() === dateFromParts(year, monthIndex, anchorDay).getUTCDate()
    case 'yearly':
      return monthOffset % 12 === 0 && candidate.getUTCDate() === dateFromParts(year, monthIndex, anchorDay).getUTCDate()
    default:
      return false
  }
}

function getScheduleOverride(schedule, scheduledDate) {
  return schedule.occurrenceOverrides?.find(override => override.scheduledDate === scheduledDate) ?? {}
}

function getLinkedScheduledDate(transaction, schedule, isIncome) {
  const prefixes = isIncome
    ? [`income:${schedule.id}:`, `${schedule.id}:`]
    : [`bill:${schedule.id}:`]
  const ids = [
    transaction.linkedOccurrenceId,
    isIncome ? transaction.linkedIncomeOccurrenceId : transaction.linkedBillOccurrenceId
  ]
  for (const id of ids) {
    if (typeof id !== 'string') continue
    const prefix = prefixes.find(value => id.startsWith(value))
    if (!prefix) continue
    const date = id.slice(prefix.length)
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  }
  return null
}

function getScheduleOccurrence(schedule, scheduledDate, isIncome, transactions = []) {
  const override = getScheduleOverride(schedule, scheduledDate)
  const occurrence = {
    ...schedule,
    ...override,
    scheduledDate,
    dueDate: override.dueDate ?? scheduledDate,
    occurrenceId: `${isIncome ? 'income' : 'bill'}:${schedule.id}:${scheduledDate}`
  }
  delete occurrence.occurrenceOverrides
  const historyEntries = schedule.paymentHistory ?? []
  const legacyEntry = historyEntries
    .filter(entry => entry.dueDate === scheduledDate && (
      entry.transactionId != null
      || entry.paid === true
      || entry.cleared === true
      || entry.status === 'received'
      || entry.received === true
    ))
    .at(-1)
  const skipEntry = [...historyEntries]
    .reverse()
    .find(entry => entry.dueDate === scheduledDate && typeof entry.skipped === 'boolean')
  const linkedTransaction = getLinkedOccurrenceTransaction(transactions, isIncome ? 'in' : 'out', {
    ...occurrence,
    transactionId: legacyEntry?.transactionId
  })
  occurrence.transactionId = linkedTransaction?.id ?? null
  occurrence.linkedTransaction = linkedTransaction
  occurrence.legacyPaid = !linkedTransaction && Boolean(legacyEntry?.paid || legacyEntry?.cleared)
  occurrence.legacyReceived = !linkedTransaction
    && Boolean(legacyEntry?.status === 'received' || legacyEntry?.received === true)
  if (isIncome) {
    occurrence.status = linkedTransaction || occurrence.legacyReceived ? 'received' : 'expected'
    occurrence.received = occurrence.status === 'received'
    occurrence.cleared = Boolean(linkedTransaction?.cleared)
  } else {
    occurrence.paid = Boolean(linkedTransaction || legacyEntry?.paid)
    occurrence.skipped = !occurrence.paid && skipEntry?.skipped === true
    occurrence.cleared = Boolean(linkedTransaction?.cleared)
  }
  return occurrence
}

function getBillOccurrence(bill, dueDate, transactions = []) {
  return getScheduleOccurrence(bill, dueDate, false, transactions)
}

export function getBillOccurrences(bills, monthDate, transactions = []) {
  const year = monthDate.getUTCFullYear()
  const monthIndex = monthDate.getUTCMonth()
  const start = formatUTCDate(new Date(Date.UTC(year, monthIndex, 1)))
  const end = formatUTCDate(new Date(Date.UTC(year, monthIndex + 1, 0)))
  return getBillOccurrencesInRange(bills, start, end, transactions)
}

export function getBillOccurrencesInRange(bills, startDate, endDate, transactions = []) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return []

  const sourceDatesBySchedule = new Map()
  for (let date = start; date <= end; date = new Date(date.getTime() + DAY_MS)) {
    const year = date.getUTCFullYear()
    const monthIndex = date.getUTCMonth()
    for (const bill of bills) {
      if (
        !bill.archived
        && bill.active !== false
        && isDueInMonth(bill, year, monthIndex, date)
      ) {
        const scheduledDate = formatUTCDate(date)
        const dates = sourceDatesBySchedule.get(bill.id) ?? new Set()
        dates.add(scheduledDate)
        sourceDatesBySchedule.set(bill.id, dates)
      }
    }
  }

  for (const bill of bills) {
    if (bill.archived || bill.active === false) continue
    for (const override of bill.occurrenceOverrides ?? []) {
      const sourceDate = new Date(`${override.scheduledDate}T00:00:00Z`)
      const effectiveDate = override.dueDate ?? override.scheduledDate
      if (
        effectiveDate >= startDate
        && effectiveDate <= endDate
        && Number.isFinite(sourceDate.getTime())
      ) {
        const dates = sourceDatesBySchedule.get(bill.id) ?? new Set()
        dates.add(override.scheduledDate)
        sourceDatesBySchedule.set(bill.id, dates)
      }
    }
    for (const entry of bill.paymentHistory ?? []) {
      if (typeof entry.dueDate !== 'string') continue
      const sourceDate = new Date(`${entry.dueDate}T00:00:00Z`)
      if (
        !Number.isFinite(sourceDate.getTime())
      ) continue
      const effectiveDate = getScheduleOverride(bill, entry.dueDate).dueDate ?? entry.dueDate
      if (effectiveDate >= startDate && effectiveDate <= endDate) {
        const dates = sourceDatesBySchedule.get(bill.id) ?? new Set()
        dates.add(entry.dueDate)
        sourceDatesBySchedule.set(bill.id, dates)
      }
    }
  }

  for (const transaction of transactions) {
    for (const bill of bills) {
      if (bill.archived || bill.active === false) continue
      const scheduledDate = getLinkedScheduledDate(transaction, bill, false)
      if (!scheduledDate) continue
      const sourceDate = new Date(`${scheduledDate}T00:00:00Z`)
      if (
        !Number.isFinite(sourceDate.getTime())
      ) continue
      const effectiveDate = getScheduleOverride(bill, scheduledDate).dueDate ?? scheduledDate
      if (effectiveDate < startDate || effectiveDate > endDate) continue
      const dates = sourceDatesBySchedule.get(bill.id) ?? new Set()
      dates.add(scheduledDate)
      sourceDatesBySchedule.set(bill.id, dates)
    }
  }

  const occurrences = [...sourceDatesBySchedule.entries()].flatMap(([id, scheduledDates]) => {
    const bill = bills.find(item => item.id === id)
    return [...scheduledDates]
      .map(scheduledDate => getBillOccurrence(bill, scheduledDate, transactions))
      .filter(occurrence => occurrence.dueDate >= startDate && occurrence.dueDate <= endDate)
  })

  return occurrences.sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name) || a.id - b.id
  )
}

export function getIncomeOccurrences(incomes, monthDate, transactions = []) {
  const year = monthDate.getUTCFullYear()
  const monthIndex = monthDate.getUTCMonth()
  const start = formatUTCDate(new Date(Date.UTC(year, monthIndex, 1)))
  const end = formatUTCDate(new Date(Date.UTC(year, monthIndex + 1, 0)))
  return getIncomeOccurrencesInRange(incomes, start, end, transactions)
}

export function getIncomeOccurrencesInRange(incomes, startDate, endDate, transactions = []) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return []

  const sourceDatesBySchedule = new Map()
  for (let date = start; date <= end; date = new Date(date.getTime() + DAY_MS)) {
    const year = date.getUTCFullYear()
    const monthIndex = date.getUTCMonth()
    for (const income of incomes) {
      if (
        !income.archived
        && income.active !== false
        && isDueInMonth(income, year, monthIndex, date)
      ) {
        const scheduledDate = formatUTCDate(date)
        const dates = sourceDatesBySchedule.get(income.id) ?? new Set()
        dates.add(scheduledDate)
        sourceDatesBySchedule.set(income.id, dates)
      }
    }
  }
  for (const income of incomes) {
    if (income.archived || income.active === false) continue
    for (const override of income.occurrenceOverrides ?? []) {
      const sourceDate = new Date(`${override.scheduledDate}T00:00:00Z`)
      const effectiveDate = override.dueDate ?? override.scheduledDate
      if (
        effectiveDate >= startDate
        && effectiveDate <= endDate
        && Number.isFinite(sourceDate.getTime())
        && isDueInMonth(income, sourceDate.getUTCFullYear(), sourceDate.getUTCMonth(), sourceDate)
      ) {
        const dates = sourceDatesBySchedule.get(income.id) ?? new Set()
        dates.add(override.scheduledDate)
        sourceDatesBySchedule.set(income.id, dates)
      }
    }
    for (const entry of income.paymentHistory ?? []) {
      if (typeof entry.dueDate !== 'string') continue
      const sourceDate = new Date(`${entry.dueDate}T00:00:00Z`)
      if (
        !Number.isFinite(sourceDate.getTime())
        || !isDueInMonth(income, sourceDate.getUTCFullYear(), sourceDate.getUTCMonth(), sourceDate)
      ) continue
      const effectiveDate = getScheduleOverride(income, entry.dueDate).dueDate ?? entry.dueDate
      if (effectiveDate >= startDate && effectiveDate <= endDate) {
        const dates = sourceDatesBySchedule.get(income.id) ?? new Set()
        dates.add(entry.dueDate)
        sourceDatesBySchedule.set(income.id, dates)
      }
    }
  }
  for (const transaction of transactions) {
    for (const income of incomes) {
      if (income.archived || income.active === false) continue
      const scheduledDate = getLinkedScheduledDate(transaction, income, true)
      if (!scheduledDate) continue
      const sourceDate = new Date(`${scheduledDate}T00:00:00Z`)
      if (
        !Number.isFinite(sourceDate.getTime())
        || !isDueInMonth(income, sourceDate.getUTCFullYear(), sourceDate.getUTCMonth(), sourceDate)
      ) continue
      const effectiveDate = getScheduleOverride(income, scheduledDate).dueDate ?? scheduledDate
      if (effectiveDate < startDate || effectiveDate > endDate) continue
      const dates = sourceDatesBySchedule.get(income.id) ?? new Set()
      dates.add(scheduledDate)
      sourceDatesBySchedule.set(income.id, dates)
    }
  }
  const occurrences = [...sourceDatesBySchedule.entries()].flatMap(([id, scheduledDates]) => {
    const income = incomes.find(item => item.id === id)
    return [...scheduledDates]
      .map(scheduledDate => getScheduleOccurrence(income, scheduledDate, true, transactions))
      .filter(occurrence => occurrence.dueDate >= startDate && occurrence.dueDate <= endDate)
  })
  return occurrences.sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name) || a.id - b.id
  )
}

export function getIncomeSummary(occurrences) {
  const totals = occurrences.reduce((result, occurrence) => {
    const cents = Math.round(occurrence.amount * 100)
    result.totalCents += cents
    result.totalCount += 1
    if (isIncomeOccurrenceReceived(occurrence)) {
      result.receivedCents += cents
      result.receivedCount += 1
    } else {
      result.expectedCents += cents
    }
    return result
  }, { totalCents: 0, receivedCents: 0, expectedCents: 0, totalCount: 0, receivedCount: 0 })

  const received = totals.receivedCents / 100
  const stillExpected = totals.expectedCents / 100
  return {
    totalExpected: received + stillExpected,
    received,
    stillExpected,
    receivedCount: totals.receivedCount,
    totalCount: totals.totalCount
  }
}

export function getScheduleViewData(flow, billOccurrences, incomeOccurrences, selectedDate, view = 'list') {
  const occurrences = flow === 'out' ? billOccurrences : incomeOccurrences
  return {
    view,
    occurrences,
    selectedDayOccurrences: occurrences.filter(item => item.dueDate === selectedDate),
    calendarDates: new Set(occurrences.map(item => item.dueDate))
  }
}

export function getScheduleSummary(flow, billOccurrences, incomeOccurrences, today) {
  if (flow === 'out') {
    const totals = getMonthBillTotals(billOccurrences, today)
    return {
      firstLabel: 'TOTAL DUE',
      firstValue: totals.paid + totals.remaining,
      secondLabel: 'CLEARED',
      secondValue: totals.paid,
      thirdLabel: 'REMAINING',
      thirdValue: totals.remaining
    }
  }

  const totals = getIncomeSummary(incomeOccurrences)
  return {
    firstLabel: 'TOTAL INCOMING',
    firstValue: totals.totalExpected,
    secondLabel: 'RECEIVED',
    secondValue: totals.received,
    thirdLabel: 'REMAINING',
    thirdValue: totals.stillExpected
  }
}

export function getPaydayIncomeSummary(incomes, period, transactions = []) {
  return period
    ? getIncomeSummary(getIncomeOccurrencesInRange(incomes, period.startDate, period.endDate, transactions))
    : null
}

export function getMonthBillTotals(occurrences, today = formatLocalDate(new Date())) {
  const dueSoonLimit = new Date(`${today}T00:00:00Z`)
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + 7)
  const dueSoonThrough = dueSoonLimit.toISOString().slice(0, 10)

  return occurrences.reduce((totals, bill) => {
    if (isBillOccurrenceCleared(bill)) {
      totals.paid += bill.amount
    } else {
      totals.remaining += bill.amount
      if (bill.dueDate >= today && bill.dueDate <= dueSoonThrough) {
        totals.dueSoon += bill.amount
      }
    }
    return totals
  }, { dueSoon: 0, paid: 0, remaining: 0 })
}

export function getPaySchedulePeriod(schedule, today = formatLocalDate(new Date())) {
  if (!schedule || typeof schedule.nextPayday !== 'string') return null
  const anchor = new Date(`${schedule.nextPayday}T00:00:00Z`)
  const todayDate = new Date(`${today}T00:00:00Z`)
  if (
    !Number.isFinite(anchor.getTime())
    || !Number.isFinite(todayDate.getTime())
    || formatUTCDate(anchor) !== schedule.nextPayday
    || formatUTCDate(todayDate) !== today
  ) return null

  if (PAY_INTERVAL_DAYS[schedule.frequency]) {
    const interval = PAY_INTERVAL_DAYS[schedule.frequency] * DAY_MS
    const nextIndex = Math.max(0, Math.ceil((todayDate.getTime() - anchor.getTime()) / interval))
    const nextPayday = new Date(anchor.getTime() + nextIndex * interval)
    const previousPayday = new Date(nextPayday.getTime() - interval)
    return {
      startDate: formatUTCDate(new Date(previousPayday.getTime() + DAY_MS)),
      endDate: formatUTCDate(nextPayday)
    }
  }

  if (schedule.frequency === 'monthly') {
    const anchorDay = anchor.getUTCDate()
    const monthsFromAnchor = (todayDate.getUTCFullYear() - anchor.getUTCFullYear()) * 12
      + todayDate.getUTCMonth() - anchor.getUTCMonth()
    const payDateAt = index => {
      const monthDate = new Date(Date.UTC(
        anchor.getUTCFullYear(),
        anchor.getUTCMonth() + index,
        1
      ))
      return dateFromParts(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), anchorDay)
    }
    let nextIndex = monthsFromAnchor
    while (payDateAt(nextIndex) < todayDate) nextIndex += 1
    while (payDateAt(nextIndex - 1) >= todayDate) nextIndex -= 1
    const nextPayday = payDateAt(nextIndex)
    const previousPayday = payDateAt(nextIndex - 1)
    return {
      startDate: formatUTCDate(new Date(previousPayday.getTime() + DAY_MS)),
      endDate: formatUTCDate(nextPayday)
    }
  }

  return null
}

export function getPaydayBillSummary(bills, period, transactions = []) {
  if (!period) return null
  const occurrences = getBillOccurrencesInRange(bills, period.startDate, period.endDate, transactions)
  const summary = occurrences.reduce((totals, bill) => {
    if (bill.skipped) {
      totals.skippedCount += 1
      return totals
    }

    totals.totalCount += 1
    const cents = Math.round(bill.amount * 100)
    const paid = isBillOccurrencePaid(bill)
    if (paid) totals.paidCents += cents
    if (isBillOccurrenceCleared(bill)) {
      totals.clearedCents += cents
      totals.clearedCount += 1
    }
    if (!paid) totals.remainingCents += cents
    return totals
  }, {
    paidCents: 0,
    clearedCents: 0,
    remainingCents: 0,
    clearedCount: 0,
    skippedCount: 0,
    totalCount: 0
  })

  const paid = summary.paidCents / 100
  const cleared = summary.clearedCents / 100
  const remaining = summary.remainingCents / 100
  return {
    totalDue: paid + remaining,
    paid,
    cleared,
    remaining,
    clearedCount: summary.clearedCount,
    totalCount: summary.totalCount,
    skippedCount: summary.skippedCount,
    occurrences
  }
}

export function loadPaySchedule(storage = localStorage) {
  const saved = storage.getItem(PAY_SCHEDULE_STORAGE_KEY)
  if (saved === null) return null

  let data
  try {
    data = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved Money Honey pay schedule could not be read.', { cause: error })
  }
  if (
    !data
    || data.version !== PAY_SCHEDULE_STORAGE_VERSION
    || !data.schedule
    || !['weekly', 'biweekly', 'monthly'].includes(data.schedule.frequency)
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.schedule.nextPayday)
    || formatUTCDate(new Date(`${data.schedule.nextPayday}T00:00:00Z`)) !== data.schedule.nextPayday
  ) {
    throw new Error('Saved Money Honey pay schedule has an unsupported or invalid format.')
  }

  return data.schedule
}

export function savePaySchedule(schedule, storage = localStorage) {
  storage.setItem(PAY_SCHEDULE_STORAGE_KEY, JSON.stringify({
    version: PAY_SCHEDULE_STORAGE_VERSION,
    schedule
  }))
}

export function updateBillPayment(bill, dueDate, cleared, changedAt = new Date().toISOString()) {
  return {
    ...bill,
    paymentHistory: [
      ...bill.paymentHistory,
      { dueDate, cleared, changedAt }
    ]
  }
}

export function updateBillOccurrenceSkip(
  bill,
  dueDate,
  skipped,
  changedAt = new Date().toISOString()
) {
  const paymentHistory = bill.paymentHistory ?? []
  const latestSkip = [...paymentHistory]
    .reverse()
    .find(entry => entry.dueDate === dueDate && typeof entry.skipped === 'boolean')
  if ((latestSkip?.skipped === true) === skipped) return bill

  const skipEntry = {
    dueDate,
    skipped,
    changedAt
  }
  if (skipped) skipEntry.skippedAt = changedAt
  else skipEntry.skipUndoneAt = changedAt

  return {
    ...bill,
    paymentHistory: [...paymentHistory, skipEntry]
  }
}

export function updateScheduleOccurrence(schedule, scheduledDate, changes) {
  const overrides = schedule.occurrenceOverrides ?? []
  const existing = overrides.find(override => override.scheduledDate === scheduledDate) ?? {}
  const updatedOverrides = [
    ...overrides.filter(override => override.scheduledDate !== scheduledDate),
    { ...existing, ...changes, scheduledDate }
  ]
  return { ...schedule, occurrenceOverrides: updatedOverrides }
}

export function updateIncomeStatus(income, dueDate, status, changedAt = new Date().toISOString(), transactionId = null) {
  if (!['expected', 'received'].includes(status)) {
    throw new Error(`Unsupported income occurrence status: ${status}`)
  }
  const historyEntry = { dueDate, status, changedAt }
  if (transactionId !== null) historyEntry.transactionId = transactionId
  return {
    ...income,
    paymentHistory: [...income.paymentHistory, historyEntry]
  }
}

export function createDemoBills(today = new Date()) {
  const year = today.getFullYear()
  const monthIndex = today.getMonth()
  const dateForDay = day => formatUTCDate(dateFromParts(year, monthIndex, day))

  return [
    { id: 1, name: 'Mortgage', amount: 1250, dueDate: dateForDay(1), frequency: 'monthly', autopay: true, accountId: 1, paymentHistory: [{ dueDate: dateForDay(1), paid: true, changedAt: today.toISOString() }] },
    { id: 2, name: 'Internet', amount: 85, dueDate: dateForDay(10), frequency: 'monthly', autopay: true, accountId: 1, paymentHistory: [] },
    { id: 3, name: 'Electric', amount: 128, dueDate: dateForDay(15), frequency: 'monthly', autopay: false, accountId: 1, paymentHistory: [] },
    { id: 4, name: 'Discover Card', amount: 214, dueDate: dateForDay(20), frequency: 'monthly', autopay: false, accountId: 1, paymentHistory: [] },
  ]
}

export function loadBills(defaultBills, storage = localStorage) {
  return loadBillData(defaultBills, storage).bills
}

export function loadBillData(defaultBills, storage = localStorage) {
  const saved = storage.getItem(BILL_STORAGE_KEY)
  if (saved === null) {
    const data = { version: BILL_STORAGE_VERSION, bills: defaultBills, incomes: [] }
    storage.setItem(BILL_STORAGE_KEY, JSON.stringify(data))
    return data
  }

  let data
  try {
    data = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved Money Honey bills could not be read.', { cause: error })
  }
  if (!data || data.version !== BILL_STORAGE_VERSION || !Array.isArray(data.bills)) {
    throw new Error('Saved Money Honey bills have an unsupported or invalid format.')
  }

  return { ...data, incomes: Array.isArray(data.incomes) ? data.incomes : [] }
}

export function saveBillData({ bills, incomes }, storage = localStorage) {
  const saved = storage.getItem(BILL_STORAGE_KEY)
  let existing = {}
  if (saved !== null) {
    try {
      existing = JSON.parse(saved)
    } catch (error) {
      throw new Error('Saved Money Honey bills could not be read.', { cause: error })
    }
  }
  storage.setItem(BILL_STORAGE_KEY, JSON.stringify({
    version: BILL_STORAGE_VERSION,
    bills: bills ?? existing.bills ?? [],
    incomes: incomes ?? existing.incomes ?? []
  }))
}

export function saveBills(bills, storage = localStorage) {
  saveBillData({ bills }, storage)
}

export function loadIncomeSchedules(storage = localStorage) {
  return loadBillData([], storage).incomes
}

export function saveIncomeSchedules(incomes, storage = localStorage) {
  saveBillData({ incomes }, storage)
}

export function createIncomeId(incomes) {
  return incomes.reduce((maxId, income) => Math.max(maxId, income.id), 0) + 1
}

export function getIncomeTransactionOptions(storage = localStorage) {
  const saved = storage.getItem('money-honey-account-data')
  if (!saved) return []
  let data
  try {
    data = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved account transactions could not be read for income linking.', { cause: error })
  }
  if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.accounts)) {
    throw new Error('Saved account transactions have an invalid format.')
  }
  const accounts = new Map(data.accounts.map(account => [account.id, account.name]))
  return data.transactions
    .filter(transaction => transaction.amount > 0)
    .map(transaction => ({
      ...transaction,
      accountName: accounts.get(transaction.accountId) ?? 'Unknown account'
    }))
}

export function linkIncomeOccurrence(income, dueDate, transactionId, changedAt = new Date().toISOString()) {
  if (!Number.isInteger(transactionId)) throw new Error('Choose a valid account transaction to link.')
  return updateIncomeStatus(income, dueDate, 'received', changedAt, transactionId)
}

export function linkIncomeToTransaction(
  income,
  dueDate,
  transactionId,
  incomes,
  storage = localStorage
) {
  const transaction = getIncomeTransactionOptions(storage)
    .find(item => item.id === transactionId)
  if (!transaction) throw new Error('The selected account transaction is unavailable.')

  const occurrenceId = `${income.id}:${dueDate}`
  const alreadyLinked = incomes.some(item =>
    item.paymentHistory.some(entry =>
      entry.transactionId === transactionId
      && !(item.id === income.id && entry.dueDate === dueDate)
    )
  )
  if (alreadyLinked) throw new Error('This account transaction is already linked to another income occurrence.')

  const linkedEntry = income.paymentHistory.filter(entry => entry.dueDate === dueDate).at(-1)
  if (linkedEntry?.transactionId === transactionId) return income
  if (linkedEntry?.transactionId != null) {
    throw new Error('This income occurrence is already linked to a different account transaction.')
  }
  if (transaction.linkedIncomeOccurrenceId && transaction.linkedIncomeOccurrenceId !== occurrenceId) {
    throw new Error('This account transaction is already linked to another income occurrence.')
  }

  return linkIncomeOccurrence(income, dueDate, transactionId)
}

export function createIncomeTransaction(income, dueDate, storage = localStorage, transactionDate = dueDate) {
  if (!income.accountId) throw new Error('Choose an associated account before creating a transaction.')
  const currentEntry = income.paymentHistory.filter(entry => entry.dueDate === dueDate).at(-1)
  if (currentEntry?.status !== 'received' && currentEntry?.received !== true) {
    throw new Error('Mark this income occurrence received before creating an account transaction.')
  }

  const accountSaved = storage.getItem('money-honey-account-data')
  if (accountSaved === null) throw new Error('No saved accounts are available for this income transaction.')

  let accountData
  try {
    accountData = JSON.parse(accountSaved)
  } catch (error) {
    throw new Error('Saved account data could not be read.', { cause: error })
  }
  if (!Array.isArray(accountData.accounts) || !Array.isArray(accountData.transactions)) {
    throw new Error('Saved account data has an invalid format.')
  }
  if (!accountData.accounts.some(account => account.id === income.accountId && !account.archived)) {
    throw new Error('The associated account is unavailable or archived.')
  }

  const occurrenceId = `${income.id}:${dueDate}`
  const existing = accountData.transactions.find(transaction =>
    transaction.linkedIncomeOccurrenceId === occurrenceId
  )
  if (existing) {
    const referencedByOtherOccurrence = loadIncomeSchedules(storage).some(item =>
      item.paymentHistory.some(entry =>
        entry.transactionId === existing.id
        && !(item.id === income.id && entry.dueDate === dueDate)
      )
    )
    if (referencedByOtherOccurrence) {
      throw new Error('This account transaction is already linked to another income occurrence.')
    }
    return updateIncomeStatus(income, dueDate, 'received', new Date().toISOString(), existing.id)
  }
  if (currentEntry?.transactionId != null) {
    throw new Error('This income occurrence is already linked to an account transaction.')
  }

  const id = accountData.transactions.reduce((max, transaction) => Math.max(max, transaction.id), 0) + 1
  const sequence = accountData.transactions.reduce(
    (max, transaction) => Math.max(max, transaction.sequence ?? transaction.id),
    0
  ) + 1
  const transaction = {
    id,
    sequence,
    accountId: income.accountId,
    name: income.name,
    amount: Math.abs(income.amount),
    date: transactionDate,
    cleared: false,
    category: income.category ?? getDefaultCategoryForFlow('in'),
    linkedIncomeOccurrenceId: occurrenceId
  }
  accountData.transactions.push(transaction)
  storage.setItem('money-honey-account-data', JSON.stringify(accountData))
  return updateIncomeStatus(income, dueDate, 'received', new Date().toISOString(), id)
}

export function getAccountOptions(storage = localStorage) {
  const saved = storage.getItem('money-honey-account-data')
  if (!saved) return []

  let data
  try {
    data = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved Money Honey account data could not be read for bills.', { cause: error })
  }
  if (!data || !Array.isArray(data.accounts)) {
    throw new Error('Saved Money Honey accounts have an invalid format.')
  }
  return data.accounts.filter(account => !account.archived)
}

export function createBillId(bills) {
  return bills.reduce((maxId, bill) => Math.max(maxId, bill.id), 0) + 1
}
