import { loadSavedAccountData, saveAccountData } from './accountStorage.js'
import { getDebtScheduledPayments, getNextScheduledDebtPayment, getPaidInstallmentNumbers, validatePaymentSchedule } from './debtSchedule.js'
import {
  createBillId,
  getBillOccurrencesInRange,
  loadBillData,
  saveBillData,
  updateScheduleOccurrence
} from './billData.js'

export const DEBT_STORAGE_KEY = 'money-honey-debts'
export const DEBT_STORAGE_VERSION = 1
const INITIAL_DEBT_ASSIGNEES = ['E', 'R', 'Joint']

const DEBT_TYPES = ['Credit Card', 'Personal Loan', 'Auto Loan', 'Mortgage', 'Medical', 'Other']
export const DEBT_PAYMENT_CALCULATION_METHODS = {
  PRINCIPAL_ONLY: 'principal-only',
  MANUAL_PRINCIPAL: 'manual-principal'
}

export function getDebtPaymentCalculationMethod(debt) {
  if (Object.values(DEBT_PAYMENT_CALCULATION_METHODS).includes(debt.paymentCalculationMethod)) {
    return debt.paymentCalculationMethod
  }
  return debt.interestRate > 0
    ? DEBT_PAYMENT_CALCULATION_METHODS.MANUAL_PRINCIPAL
    : DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY
}

export function debtPaymentNeedsBalanceReview(debt, payment) {
  if (payment.reversedAt) return false
  if (payment.balanceReviewRequired === true) return true
  return payment.automaticPrincipal === true
    && payment.principal === 0
    && payment.calculationMethod == null
    && debt.interestRate > 0
}

function assertDebts(debts) {
  if (!Array.isArray(debts) || debts.some(debt =>
    !Number.isInteger(debt.id)
    || typeof debt.name !== 'string'
    || !Number.isFinite(debt.startingBalance)
    || !Number.isFinite(debt.currentBalance)
    || !Array.isArray(debt.paymentHistory)
  )) {
    throw new Error('Saved Money Honey debt data is invalid.')
  }
  debts.forEach(validateDebtMetadata)
}

export function validateDebtMetadata(debt) {
  validatePaymentSchedule(debt.paymentSchedule)
  if ((debt.paymentHistory ?? []).some(payment => payment.installmentNumber != null && (
    !Number.isInteger(payment.installmentNumber) || payment.installmentNumber < 1 || payment.installmentNumber > 600
    || (!payment.reversedAt && debt.paymentSchedule?.totalInstallments != null && payment.installmentNumber > debt.paymentSchedule.totalInstallments)
  ))) throw new Error('The installment total must include recorded installment numbers, and installment numbers must be valid.')
  if (debt.statementDetails != null) {
    if (typeof debt.statementDetails !== 'object' || Array.isArray(debt.statementDetails)
      || Object.entries(debt.statementDetails).some(([key, value]) =>
        !['purchaseAmount', 'totalRepayment', 'totalInterest', 'amountAlreadyPaid', 'nextPaymentAmount'].includes(key)
        || !Number.isFinite(value) || value < 0
      )) throw new Error('Statement plan amounts must be valid non-negative amounts.')
  }
  if (debt.creditLimit != null && (!Number.isFinite(debt.creditLimit) || debt.creditLimit < 0)) {
    throw new Error('Credit limit must be zero or more.')
  }
  if (debt.accountLast4 != null && debt.accountLast4 !== '' && (
    typeof debt.accountLast4 !== 'string'
    || debt.accountLast4.length !== 4
    || !/^\d{4}$/.test(debt.accountLast4)
  )) {
    throw new Error('Account last four must contain exactly four digits.')
  }
  if (debt.assignedTo != null && debt.assignedTo !== '' && (
    typeof debt.assignedTo !== 'string' || !debt.assignedTo.trim()
  )) {
    throw new Error('Choose a valid debt assignee.')
  }
  if (debt.customAssignee != null && typeof debt.customAssignee !== 'string') {
    throw new Error('Enter a valid custom assignee.')
  }
}

export function getDebtAssignee(debt, assignees) {
  // Read legacy custom assignments without rewriting the saved debt.
  const name = (debt.assignedTo === 'Other' && debt.customAssignee?.trim()
    ? debt.customAssignee
    : debt.assignedTo)?.trim()
  return assignees?.find(assignee => assigneeKey(assignee) === assigneeKey(name)) ?? name
}

function assigneeKey(name) {
  return name?.trim().toLocaleLowerCase('en-US') ?? ''
}

export function validateDebtAssignees(assignees, debts = []) {
  if (!Array.isArray(assignees) || assignees.some(name =>
    typeof name !== 'string' || !name.trim() || name !== name.trim()
  )) throw new Error('Saved Money Honey debt assignees are invalid.')
  const keys = new Set(assignees.map(assigneeKey))
  if (keys.size !== assignees.length) throw new Error('An assignee with that name already exists.')
  if (debts.some(debt => getDebtAssignee(debt) && !keys.has(assigneeKey(getDebtAssignee(debt))))) {
    throw new Error('A debt is assigned to an assignee missing from the list.')
  }
}

function includeDebtAssignees(assignees, debts) {
  const names = [...assignees]
  for (const debt of debts) {
    const name = getDebtAssignee(debt)
    if (name && !names.some(item => assigneeKey(item) === assigneeKey(name))) names.push(name)
  }
  return names
}

export function getAvailableCredit(debt) {
  if (debt.type !== 'Credit Card' || !Number.isFinite(debt.creditLimit)) return null
  return roundMoney(debt.creditLimit - debt.currentBalance)
}

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function normalizeAllocation(total, allocation) {
  const result = {
    principal: roundMoney(Number(allocation.principal ?? 0)),
    interest: roundMoney(Number(allocation.interest ?? 0)),
    fees: roundMoney(Number(allocation.fees ?? 0))
  }
  if (
    !Number.isFinite(total)
    || total <= 0
    || Object.values(result).some(value => !Number.isFinite(value) || value < 0)
    || roundMoney(result.principal + result.interest + result.fees) > roundMoney(total)
  ) {
    throw new Error('Enter a valid payment breakdown no greater than the payment total.')
  }
  return result
}

export function loadDebtData(storage = localStorage) {
  const saved = storage.getItem(DEBT_STORAGE_KEY)
  if (saved === null) return { debts: [], assignees: [...INITIAL_DEBT_ASSIGNEES] }

  let data
  try {
    data = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved Money Honey debt data could not be read.', { cause: error })
  }
  if (!data || data.version !== DEBT_STORAGE_VERSION) {
    throw new Error('Saved Money Honey debt data has an unsupported format.')
  }
  assertDebts(data.debts)
  const assignees = data.assignees === undefined
    ? includeDebtAssignees(INITIAL_DEBT_ASSIGNEES, data.debts)
    : data.assignees
  validateDebtAssignees(assignees, data.debts)
  return { debts: data.debts, assignees }
}

export function loadDebts(storage = localStorage) {
  return loadDebtData(storage).debts
}

function saveDebtData({ debts, assignees }, storage) {
  assertDebts(debts)
  validateDebtAssignees(assignees, debts)
  storage.setItem(DEBT_STORAGE_KEY, JSON.stringify({
    version: DEBT_STORAGE_VERSION,
    debts,
    assignees
  }))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('money-honey-debts-updated'))
  }
  return { debts, assignees }
}

export function saveDebts(debts, storage = localStorage) {
  assertDebts(debts)
  const { assignees } = loadDebtData(storage)
  return saveDebtData({ debts, assignees: includeDebtAssignees(assignees, debts) }, storage)
}

function checkAssigneeName(name, assignees, previousName) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Enter an assignee name.')
  const trimmed = name.trim()
  if (assignees.some(item => item !== previousName && assigneeKey(item) === assigneeKey(trimmed))) {
    throw new Error('An assignee with that name already exists.')
  }
  return trimmed
}

export function addDebtAssignee(name, storage = localStorage) {
  const data = loadDebtData(storage)
  const nextName = checkAssigneeName(name, data.assignees)
  return saveDebtData({ ...data, assignees: [...data.assignees, nextName] }, storage)
}

function changeDebtAssignee(name, nextName, storage) {
  const { debts, assignees } = loadDebtData(storage)
  if (!assignees.includes(name)) throw new Error('That assignee no longer exists.')
  const replacement = nextName === null ? '' : checkAssigneeName(nextName, assignees, name)
  const nextDebts = debts.map(debt => {
    if (getDebtAssignee(debt, assignees) !== name) return debt
    const updated = { ...debt, assignedTo: replacement }
    delete updated.customAssignee
    return updated
  })
  return saveDebtData({
    debts: nextDebts,
    assignees: nextName === null
      ? assignees.filter(item => item !== name)
      : assignees.map(item => item === name ? replacement : item)
  }, storage)
}

export function renameDebtAssignee(name, nextName, storage = localStorage) {
  return changeDebtAssignee(name, nextName, storage)
}

export function deleteDebtAssignee(name, storage = localStorage) {
  return changeDebtAssignee(name, null, storage)
}

export function isDebtPaidOff(debt) {
  return Number(debt?.currentBalance) <= 0
}

function isTransactionLinkedToDebt(transaction, debt) {
  return transaction.linkedDebtId === debt.id
    || (debt.paymentHistory ?? []).some(payment => payment.transactionId != null && payment.transactionId === transaction.id)
}

export function getDebtDeletionLinks(debt, transactions = []) {
  return {
    payments: (debt.paymentHistory ?? []).filter(payment => !payment.reversedAt).length,
    transactions: transactions.filter(transaction => isTransactionLinkedToDebt(transaction, debt)).length
  }
}

// Deletes one debt. Linked account transactions are kept and only unlinked, so a later debt that reuses
// the id cannot inherit them. A schedule bill created for the debt is removed, or archived if it holds
// payment history; a user-created bill that was linked to the debt is kept and unlinked.
export function deleteDebt(debtId, storage = localStorage) {
  const debts = loadDebts(storage)
  const debt = debts.find(item => item.id === debtId)
  if (!debt) throw new Error('This debt no longer exists.')

  const accountData = loadSavedAccountData(storage)
  const linkedTransactions = accountData?.transactions.filter(transaction => isTransactionLinkedToDebt(transaction, debt)) ?? []
  const { bills } = loadBillData([], storage)
  const isLinkedBill = bill => bill.debtId === debt.id
  const nextBills = bills.flatMap(bill => {
    if (!isLinkedBill(bill)) return [bill]
    if (!bill.debtManaged) return [{ ...bill, debtId: null }]
    if (!(bill.paymentHistory ?? []).length) return []
    return [{ ...bill, debtId: null, debtManaged: false, active: false, archived: true }]
  })

  if (linkedTransactions.length) {
    const transactions = accountData.transactions.map(transaction => {
      if (!linkedTransactions.includes(transaction)) return transaction
      const unlinked = { ...transaction }
      delete unlinked.linkedDebtId
      delete unlinked.linkedDebtPaymentId
      return unlinked
    })
    saveAccountData(accountData.accounts, transactions, storage)
  }
  if (bills.some(isLinkedBill)) {
    saveBillData({ bills: nextBills }, storage)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('money-honey-bills-updated'))
  }
  return saveDebts(debts.filter(item => item.id !== debt.id), storage).debts
}

export function createDebtId(debts) {
  return debts.reduce((max, debt) => Math.max(max, debt.id), 0) + 1
}

export function getDebtProgress(debt) {
  if (debt.startingBalance <= 0) return 100
  return Math.min(100, Math.max(
    0,
    ((debt.startingBalance - debt.currentBalance) / debt.startingBalance) * 100
  ))
}

export function getDebtRemainingPercent(debt) {
  if (!Number.isFinite(debt.startingBalance) || debt.startingBalance <= 0) {
    return debt.currentBalance > 0 ? 100 : 0
  }
  return Math.min(100, Math.max(0, (debt.currentBalance / debt.startingBalance) * 100))
}

export function getDebtPrincipalPaid(debt) {
  return roundMoney((debt.paymentHistory ?? [])
    .filter(payment => !payment.reversedAt)
    .reduce((sum, payment) => sum + payment.principal, 0))
}

export function calculateOverallDebtSummary(debts) {
  const totalStarting = roundMoney(debts.reduce((sum, debt) => sum + (Number(debt.startingBalance) || 0), 0))
  const totalRemaining = roundMoney(debts.reduce((sum, debt) => sum + (Number(debt.currentBalance) || 0), 0))
  const totalPaidOff = roundMoney(Math.max(0, totalStarting - totalRemaining))
  const progressPercent = totalStarting > 0
    ? Math.min(100, Math.max(0, Math.round(((totalStarting - totalRemaining) / totalStarting) * 100)))
    : 0
  return {
    totalStarting,
    totalRemaining,
    totalPaidOff,
    progressPercent
  }
}

export function calculateDebtDueDate(nextPaymentDue, monthsAhead = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextPaymentDue ?? '') || !Number.isInteger(monthsAhead)) {
    return null
  }
  const anchor = new Date(`${nextPaymentDue}T00:00:00Z`)
  if (!Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== nextPaymentDue) {
    return null
  }
  const year = anchor.getUTCFullYear()
  const month = anchor.getUTCMonth() + monthsAhead
  const targetMonth = new Date(Date.UTC(year, month, 1))
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate()
  const day = Math.min(anchor.getUTCDate(), lastDay)
  return new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), day))
    .toISOString()
    .slice(0, 10)
}

function validISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function addDays(date, days) {
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export function getDebtScheduleStatus(debt, bills, transactions = [], today = new Date().toLocaleDateString('en-CA')) {
  const savedBill = bills.find(item => item.id === debt.billId && item.debtId === debt.id)
    ?? bills.find(item => item.debtId === debt.id)
    ?? bills.find(item => item.id === debt.billId && item.debtId == null)
  const bill = savedBill && debt.paymentSchedule ? updateDebtSchedule(savedBill, debt, false) : savedBill
  if (!bill || !validISODate(bill.dueDate) || bill.archived || bill.active === false) {
    const nextDueDate = getNextDebtPaymentDue(debt, today)
    const pastDue = validISODate(nextDueDate) && nextDueDate < today
    return {
      nextDueDate,
      nextScheduledDate: nextDueDate,
      nextPaymentAmount: getNextScheduledDebtPayment(debt)?.amount ?? debt.minimumPayment ?? null,
      overdueAmount: 0,
      overdueCount: 0,
      oldestOverdueDate: null,
      isPastDue: pastDue,
      isDueToday: nextDueDate === today
    }
  }

  const scheduledDates = [
    bill.dueDate,
    ...(bill.occurrenceOverrides ?? []).map(override => override.scheduledDate),
    ...(bill.occurrenceOverrides ?? []).map(override => override.dueDate),
    ...(bill.paymentHistory ?? []).map(payment => payment.dueDate),
    ...transactions.flatMap(transaction => {
      const occurrenceId = transaction.linkedBillOccurrenceId
        ?? (transaction.linkedOccurrenceType === 'bill' ? transaction.linkedOccurrenceId : null)
      const prefix = `bill:${bill.id}:`
      return typeof occurrenceId === 'string' && occurrenceId.startsWith(prefix)
        ? [occurrenceId.slice(prefix.length)]
        : []
    })
  ].filter(validISODate)
  const startDate = scheduledDates.reduce((earliest, date) => date < earliest ? date : earliest, bill.dueDate)
  const latestKnownDate = scheduledDates.reduce((latest, date) => date > latest ? date : latest, today)
  const endDate = [addDays(today, 400), addDays(latestKnownDate, 400), bill.dueDate]
    .reduce((latest, date) => date > latest ? date : latest)
  const occurrences = getBillOccurrencesInRange(
    [bill],
    startDate,
    endDate,
    transactions
  )
  const unpaidOccurrences = occurrences.filter(occurrence => !occurrence.paid && !occurrence.skipped)
  const overdueOccurrences = unpaidOccurrences.filter(occurrence => occurrence.dueDate < today)
  const nextUnpaid = unpaidOccurrences[0]

  return {
    nextDueDate: nextUnpaid?.dueDate ?? '',
    nextScheduledDate: nextUnpaid?.scheduledDate ?? '',
    nextPaymentAmount: nextUnpaid?.amount ?? null,
    overdueAmount: roundMoney(overdueOccurrences.reduce((sum, occurrence) => sum + Math.abs(occurrence.amount), 0)),
    overdueCount: overdueOccurrences.length,
    oldestOverdueDate: overdueOccurrences[0]?.dueDate ?? null,
    isPastDue: overdueOccurrences.length > 0,
    isDueToday: !overdueOccurrences.length && nextUnpaid?.dueDate === today
  }
}

export function getNextDebtPaymentDue(debt, today = new Date().toLocaleDateString('en-CA')) {
  if (debt.paymentSchedule) return getNextScheduledDebtPayment(debt)?.dueDate ?? ''
  const dueDate = debt.nextPaymentDue
  if (dueDate) return dueDate
  if (!Number.isInteger(debt.paymentDueDay) || debt.paymentDueDay < 1 || debt.paymentDueDay > 31) {
    return ''
  }
  const current = new Date(`${today}T00:00:00Z`)
  if (!Number.isFinite(current.getTime())) return ''
  const initial = new Date(Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    Math.min(
      debt.paymentDueDay,
      new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate()
    )
  ))
  const next = initial < current
    ? new Date(Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth() + 1,
      Math.min(
        debt.paymentDueDay,
        new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 2, 0)).getUTCDate()
      )
    ))
    : initial
  return next.toISOString().slice(0, 10)
}

export function validateDebt(debt) {
  validateDebtMetadata(debt)
  if (!DEBT_TYPES.includes(debt.type)) throw new Error('Choose a valid debt type.')
  if (!debt.name?.trim()) throw new Error('Enter a debt name.')
  if (
    !Number.isFinite(debt.startingBalance)
    || debt.startingBalance < 0
    || !Number.isFinite(debt.currentBalance)
    || debt.currentBalance < 0
  ) throw new Error('Starting and current balances must be zero or more.')
  if (debt.interestRate != null && (!Number.isFinite(debt.interestRate) || debt.interestRate < 0)) {
    throw new Error('Interest rate must be zero or more.')
  }
  if (debt.minimumPayment != null && (!Number.isFinite(debt.minimumPayment) || debt.minimumPayment < 0)) {
    throw new Error('Minimum payment must be zero or more.')
  }
  if (
    debt.paymentCalculationMethod != null
    && !Object.values(DEBT_PAYMENT_CALCULATION_METHODS).includes(debt.paymentCalculationMethod)
  ) throw new Error('Choose a valid debt payment calculation method.')
  if (debt.paymentDueDay != null && (!Number.isInteger(debt.paymentDueDay) || debt.paymentDueDay < 1 || debt.paymentDueDay > 31)) {
    throw new Error('Payment due day must be between 1 and 31.')
  }
  if (debt.linkedAccountId != null && !Number.isInteger(debt.linkedAccountId)) {
    throw new Error('Choose a valid linked credit card account.')
  }
  if (debt.nextPaymentDue != null && debt.nextPaymentDue !== '') {
    const parsedDate = new Date(`${debt.nextPaymentDue}T00:00:00Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(debt.nextPaymentDue)
      || !Number.isFinite(parsedDate.getTime())
      || parsedDate.toISOString().slice(0, 10) !== debt.nextPaymentDue
    ) throw new Error('Choose a valid next payment due date.')
  }
  return {
    ...debt,
    name: debt.name.trim(),
    paymentCalculationMethod: getDebtPaymentCalculationMethod(debt),
    paymentHistory: debt.paymentHistory ?? []
  }
}

function debtHasPaymentSchedule(debt) {
  if (debt.paymentSchedule?.totalInstallments != null) return Boolean(debt.paymentSchedule.startDate)
  return Number.isFinite(debt.minimumPayment)
    && debt.minimumPayment > 0
    && calculateDebtDueDate(debt.nextPaymentDue, 0) === debt.nextPaymentDue
}

export function getMatchingDebtBill(bills, debt) {
  if (debt.paymentSchedule && debt.paymentSchedule.kind !== 'monthly') return null
  const dueDay = debt.nextPaymentDue?.slice(-2)
  return bills.find(bill =>
    bill.debtId == null
    && !bill.archived
    && bill.active !== false
    && bill.frequency === 'monthly'
    && bill.name.trim().toLocaleLowerCase() === debt.name.trim().toLocaleLowerCase()
    && bill.amount === debt.minimumPayment
    && bill.dueDate?.slice(-2) === dueDay
  )
}

function preserveDebtBillHistory(bill) {
  const overrides = [...(bill.occurrenceOverrides ?? [])]
  for (const payment of bill.paymentHistory ?? []) {
    if (!payment.dueDate) continue
    const index = overrides.findIndex(item => item.scheduledDate === payment.dueDate)
    const previous = index < 0 ? {} : overrides[index]
    const historicalOverride = {
      ...previous,
      scheduledDate: payment.dueDate,
      dueDate: previous.dueDate ?? payment.dueDate,
      name: previous.name ?? bill.name,
      amount: previous.amount ?? bill.amount
    }
    if (index < 0) overrides.push(historicalOverride)
    else overrides[index] = historicalOverride
  }
  return overrides
}

function debtBillFrequency(frequency) {
  return frequency === 'days' ? 'interval' : frequency === 'annual' ? 'yearly' : frequency ?? 'monthly'
}

function updateDebtSchedule(bill, debt, managed) {
  const schedule = debt.paymentSchedule
  const finite = schedule?.totalInstallments != null
  const generated = finite ? getDebtScheduledPayments(debt) : []
  const history = preserveDebtBillHistory(bill)
  const historicalDates = new Set([
    ...(bill.paymentHistory ?? []).map(item => item.dueDate),
    ...(debt.paymentHistory ?? []).filter(item => !item.reversedAt).map(item => item.scheduledDueDate)
  ])
  const paidNumbers = finite ? getPaidInstallmentNumbers(debt) : new Set()
  const historicalNumbers = new Set(history.filter(item => historicalDates.has(item.scheduledDate))
    .map(item => item.installmentNumber).filter(Number.isInteger))
  const overrides = finite ? [
    ...history.filter(item => historicalDates.has(item.scheduledDate)).map(item => ({
      ...item, ...(schedule.dateAdjustments?.find(change => change.scheduledDate === item.scheduledDate) ?? {})
    })),
    ...generated.filter(item => !historicalDates.has(item.scheduledDate) && !paidNumbers.has(item.installmentNumber) && !historicalNumbers.has(item.installmentNumber)).map(item => {
      const previous = (bill.occurrenceOverrides ?? []).find(override => override.scheduledDate === item.scheduledDate)
      return {
        ...previous, ...item,
        dueDate: previous?.dueDate ?? item.dueDate,
        ...(previous?.debtAmountOverride ? { amount: previous.amount, debtAmountOverride: true } : {}),
        // Explicit debt-form date edits take precedence over a prior bill date edit.
        ...(schedule.dateAdjustments?.find(change => change.scheduledDate === item.scheduledDate) ?? {})
      }
    })
  ] : schedule ? [
    ...history.filter(item => !schedule.dateAdjustments?.some(change => change.scheduledDate === item.scheduledDate)),
    ...(schedule.dateAdjustments ?? [])
  ] : history
  return {
    ...bill,
    name: debt.name,
    amount: finite ? generated[0]?.amount ?? bill.amount ?? 0 : debt.minimumPayment,
    dueDate: schedule?.startDate || debt.nextPaymentDue,
    frequency: finite ? 'debt-installments' : debtBillFrequency(schedule?.frequency),
    ...(schedule ? { intervalDays: schedule.intervalDays, debtDueDay: schedule.dueDay } : {}),
    ...(!finite && schedule?.frequency === 'twice-monthly' ? { daysOfMonth: schedule.daysOfMonth } : {}),
    debtId: debt.id,
    debtManaged: managed,
    ...(managed ? { active: true, archived: false } : {}),
    occurrenceOverrides: overrides
  }
}

export function synchronizeDebtBills(storage = localStorage, choices = {}) {
  const data = loadBillData([], storage)
  let bills = data.bills
  let debts = loadDebts(storage)
  let billsChanged = false
  let debtsChanged = false

  debts = debts.map(debt => {
    const linked = bills.find(bill =>
      bill.id === debt.billId && (bill.debtId == null || bill.debtId === debt.id)
    )
      ?? bills.find(bill => bill.debtId === debt.id)
    if (!debtHasPaymentSchedule(debt)) {
      if (!linked) {
        if (debt.billId == null) return debt
        debtsChanged = true
        return { ...debt, billId: null }
      }
      billsChanged = true
      if (linked.debtManaged) {
        bills = bills.map(bill => bill.id === linked.id
          ? { ...bill, active: false, archived: true }
          : bill)
      } else {
        bills = bills.map(bill => bill.id === linked.id ? { ...bill, debtId: null } : bill)
      }
      debtsChanged = true
      return { ...debt, billId: null }
    }

    if (linked) {
      const managed = Boolean(linked.debtManaged)
      bills = bills.map(bill => bill.id === linked.id
        ? updateDebtSchedule(bill, debt, managed)
        : bill)
      billsChanged = true
      if (debt.billId === linked.id) return debt
      debtsChanged = true
      return { ...debt, billId: linked.id }
    }

    const chosenBillId = choices[debt.id]
    const matching = chosenBillId === false
      ? null
      : chosenBillId == null
        ? getMatchingDebtBill(bills, debt)
        : bills.find(bill => bill.id === chosenBillId)
    if (matching) {
      bills = bills.map(bill => bill.id === matching.id
        ? { ...updateDebtSchedule(bill, debt, false), debtManaged: false }
        : bill)
      billsChanged = true
      if (debt.billId === matching.id) return debt
      debtsChanged = true
      return { ...debt, billId: matching.id }
    }

    const id = createBillId(bills)
    bills = [...bills, updateDebtSchedule({
      id,
      name: debt.name,
      amount: debt.minimumPayment,
      dueDate: debt.nextPaymentDue,
      frequency: 'monthly',
      autopay: false,
      accountId: debt.accountId ?? null,
      debtId: debt.id,
      debtManaged: true,
      active: true,
      archived: false,
      paymentHistory: [],
      occurrenceOverrides: []
    }, debt, true)]
    billsChanged = true
    debtsChanged = true
    return { ...debt, billId: id }
  })

  if (billsChanged) {
    saveBillData({ bills }, storage)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('money-honey-bills-updated'))
    }
  }
  if (debtsChanged) saveDebts(debts, storage)
  return { bills, debts }
}

function getNextPaymentId(debt) {
  return `${debt.id}:${(debt.paymentHistory ?? []).reduce((max, payment) => Math.max(max, payment.sequence ?? 0), 0) + 1}`
}

function updateBalanceReviewFlag(debt) {
  debt.balanceNeedsReview = debt.paymentHistory.some(payment =>
    debtPaymentNeedsBalanceReview(debt, payment)
  )
}

export function applyPrincipalOnlyToReviewPayments(debt) {
  let currentBalance = debt.currentBalance
  const paymentHistory = debt.paymentHistory.map(payment => {
    if (!debtPaymentNeedsBalanceReview(debt, payment)) return payment

    const principal = roundMoney(Math.min(payment.total, currentBalance))
    currentBalance = roundMoney(Math.max(0, currentBalance - principal))
    return {
      ...payment,
      principal,
      interest: 0,
      fees: 0,
      automaticPrincipal: true,
      balanceReviewRequired: false,
      calculationMethod: DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY,
      corrections: [...(payment.corrections ?? []), {
        total: payment.total,
        principal: payment.principal,
        date: payment.date,
        changedAt: new Date().toISOString(),
        reason: 'Principal-only calculation selected'
      }]
    }
  })
  const updatedDebt = { ...debt, currentBalance, paymentHistory }
  updateBalanceReviewFlag(updatedDebt)
  return updatedDebt
}

function getLinkedPaymentAllocation(debt, total, details) {
  const calculationMethod = getDebtPaymentCalculationMethod(debt)
  const explicitAllocation = details.principalAllocationExplicit === true
    || (details.automaticPrincipal !== true && details.principal != null)
  if (explicitAllocation) {
    return {
      allocation: normalizeAllocation(total, details),
      automaticPrincipal: false,
      balanceReviewRequired: false,
      calculationMethod
    }
  }

  if (calculationMethod === DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY) {
    return {
      allocation: {
        principal: roundMoney(Math.min(total, debt.currentBalance)),
        interest: 0,
        fees: 0
      },
      automaticPrincipal: true,
      balanceReviewRequired: false,
      calculationMethod
    }
  }

  return {
    allocation: { principal: 0, interest: 0, fees: 0 },
    automaticPrincipal: true,
    balanceReviewRequired: true,
    calculationMethod
  }
}

function getLinkedBillOccurrence(transaction, details) {
  const transactionOccurrenceId = transaction.linkedBillOccurrenceId
    ?? (transaction.linkedOccurrenceType === 'bill' ? transaction.linkedOccurrenceId : null)
  const billOccurrenceId = transactionOccurrenceId ?? details.billOccurrenceId ?? null
  const match = typeof billOccurrenceId === 'string'
    ? /^bill:\d+:(\d{4}-\d{2}-\d{2})$/.exec(billOccurrenceId)
    : null
  const scheduledDueDate = match && validISODate(match[1])
    ? match[1]
    : details.scheduledDueDate ?? null
  return { billOccurrenceId, scheduledDueDate }
}

function getUnpaidDebtSlot(debt, storage) {
  if (!debt.paymentSchedule) return null
  const { bills } = loadBillData([], storage)
  const savedBill = bills.find(item => item.debtId === debt.id)
  if (!savedBill) return getNextScheduledDebtPayment(debt)
  const bill = updateDebtSchedule(savedBill, debt, false)
  const transactions = loadSavedAccountData(storage)?.transactions ?? []
  const status = getDebtScheduleStatus(debt, bills, transactions)
  if (!status.nextDueDate) return null
  return getBillOccurrencesInRange([bill], status.nextDueDate, status.nextDueDate, transactions)
    .find(item => !item.paid && !item.skipped) ?? null
}

function alignDebtBillOccurrence(occurrenceId, transaction, storage) {
  if (!occurrenceId) return
  const [, id, date] = /^bill:(\d+):(\d{4}-\d{2}-\d{2})$/.exec(occurrenceId) ?? []
  if (!id) throw new Error('The debt payment occurrence reference is invalid.')
  const data = loadBillData([], storage)
  saveBillData({ bills: data.bills.map(bill => bill.id === Number(id) ? updateScheduleOccurrence(bill, date, {
    name: transaction.name, amount: Math.abs(transaction.amount), accountId: transaction.accountId
  }) : bill) }, storage)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('money-honey-bills-updated'))
}

export function recordDebtPaymentFromTransaction(
  debtId,
  transactionId,
  details,
  storage = localStorage
) {
  const debts = loadDebts(storage)
  const debt = debts.find(item => item.id === debtId)
  if (!debt) throw new Error('The linked debt is no longer available.')
  const accountData = loadSavedAccountData(storage)
  const transaction = accountData?.transactions.find(item => item.id === transactionId)
  if (!transaction || transaction.amount >= 0) {
    throw new Error('A debt payment must link to an existing expense transaction.')
  }

  let { billOccurrenceId, scheduledDueDate } = getLinkedBillOccurrence(transaction, details)
  let inferredOccurrence = false
  if (!scheduledDueDate && debt.paymentSchedule) {
    const slot = getUnpaidDebtSlot(debt, storage)
    if (slot) {
      scheduledDueDate = slot.scheduledDate
      if (debt.billId != null) {
        billOccurrenceId = `bill:${debt.billId}:${slot.scheduledDate}`
        transaction.linkedBillOccurrenceId = billOccurrenceId
        inferredOccurrence = true
      }
    }
  }
  const existing = debt.paymentHistory.find(payment =>
    !payment.reversedAt && (
    payment.transactionId === transactionId
    || (billOccurrenceId && payment.billOccurrenceId === billOccurrenceId)
    )
  )
  if (existing) return existing

  const total = roundMoney(Math.abs(transaction.amount))
  const {
    allocation,
    automaticPrincipal,
    balanceReviewRequired,
    calculationMethod
  } = getLinkedPaymentAllocation(debt, total, details)
  if (allocation.principal > debt.currentBalance) {
    throw new Error('Principal cannot exceed the current debt balance.')
  }
  const payment = {
    id: getNextPaymentId(debt),
    sequence: debt.paymentHistory.length + 1,
    transactionId,
    date: transaction.date,
    total,
    ...allocation,
    automaticPrincipal,
    balanceReviewRequired,
    calculationMethod,
    scheduledDueDate,
    billOccurrenceId,
    ...(debt.paymentSchedule?.totalInstallments != null ? {
      installmentNumber: getDebtScheduledPayments(debt).find(item => item.scheduledDate === scheduledDueDate)?.installmentNumber
        ?? loadBillData([], storage).bills.find(item => item.id === debt.billId)?.occurrenceOverrides
          ?.find(item => item.scheduledDate === scheduledDueDate)?.installmentNumber ?? null
    } : {})
  }
  transaction.linkedDebtId = debt.id
  transaction.linkedDebtPaymentId = payment.id
  transaction.transactionType = 'debt-payment'
  debt.paymentHistory = [...debt.paymentHistory, payment]
  debt.currentBalance = roundMoney(Math.max(0, debt.currentBalance - payment.principal))
  updateBalanceReviewFlag(debt)
  saveAccountData(accountData.accounts, accountData.transactions, storage)
  saveDebts(debts, storage)
  if (inferredOccurrence) alignDebtBillOccurrence(billOccurrenceId, transaction, storage)
  return payment
}

export function createDebtPayment(debtId, paymentId, details, storage = localStorage) {
  const debts = loadDebts(storage)
  const debt = debts.find(item => item.id === debtId)
  if (!debt) throw new Error('The selected debt is no longer available.')
  if (!paymentId) throw new Error('A unique payment reference is required.')
  const existing = debt.paymentHistory.find(payment => payment.id === paymentId)
  if (existing) return existing

  const total = roundMoney(Number(details.total))
  const allocation = normalizeAllocation(total, details)
  if (!details.date) throw new Error('Choose a payment date.')
  const accountId = details.accountId ?? debt.accountId
  if (!Number.isInteger(accountId)) throw new Error('Choose an account for this payment.')
  if (allocation.principal > debt.currentBalance) {
    throw new Error('Principal cannot exceed the current debt balance.')
  }
  const accountData = loadSavedAccountData(storage)
  if (!accountData) throw new Error('No saved account is available for this payment.')
  if (!accountData.accounts.some(account => account.id === accountId && !account.archived)) {
    throw new Error('The selected payment account is unavailable or archived.')
  }

  const existingTransaction = accountData.transactions.find(transaction =>
    transaction.linkedDebtId === debt.id
    && transaction.linkedDebtPaymentId === paymentId
  )
  if (existingTransaction && (
    existingTransaction.accountId !== accountId
    || existingTransaction.amount !== -total
    || existingTransaction.date !== details.date
  )) {
    throw new Error('The saved debt payment reference does not match this amount and account.')
  }
  const id = existingTransaction?.id
    ?? accountData.transactions.reduce((max, transaction) => Math.max(max, transaction.id), 0) + 1
  const sequence = existingTransaction?.sequence
    ?? accountData.transactions.reduce(
      (max, transaction) => Math.max(max, transaction.sequence ?? transaction.id),
      0
    ) + 1
  const nextScheduled = getUnpaidDebtSlot(debt, storage)
  if (nextScheduled && Math.round(nextScheduled.amount * 100) !== Math.round(total * 100)) {
    throw new Error('This amount does not match the scheduled installment. Adjust the scheduled amount before recording its payment.')
  }
  const billOccurrenceId = nextScheduled && debt.billId != null ? `bill:${debt.billId}:${nextScheduled.scheduledDate}` : null
  const payment = {
    id: paymentId,
    sequence: debt.paymentHistory.length + 1,
    transactionId: id,
    date: details.date,
    total,
    ...allocation,
    billOccurrenceId,
    ...(nextScheduled ? {
      scheduledDueDate: nextScheduled.scheduledDate,
      ...(nextScheduled.installmentNumber != null ? { installmentNumber: nextScheduled.installmentNumber } : {})
    } : {})
  }
  if (!existingTransaction) {
    accountData.transactions.push({
      id,
      sequence,
      accountId,
      name: billOccurrenceId ? debt.name : `Debt payment · ${debt.name}`,
      amount: -total,
      date: details.date,
      cleared: false,
      category: 'Debt Payments',
      linkedDebtId: debt.id,
      linkedDebtPaymentId: paymentId,
      transactionType: 'debt-payment',
      ...(billOccurrenceId ? { linkedBillOccurrenceId: billOccurrenceId, linkedOccurrenceType: 'bill', linkedOccurrenceId: billOccurrenceId } : {})
    })
  }
  debt.paymentHistory = [...debt.paymentHistory, payment]
  debt.currentBalance = roundMoney(Math.max(0, debt.currentBalance - payment.principal))
  updateBalanceReviewFlag(debt)
  saveAccountData(accountData.accounts, accountData.transactions, storage)
  saveDebts(debts, storage)
  if (billOccurrenceId) alignDebtBillOccurrence(billOccurrenceId, accountData.transactions.find(item => item.id === id), storage)
  return payment
}

export function reverseDebtPayment(paymentId, storage = localStorage) {
  const debts = loadDebts(storage)
  const debt = debts.find(item => item.paymentHistory.some(payment =>
    payment.id === paymentId && !payment.reversedAt
  ))
  if (!debt) throw new Error('The debt payment no longer exists.')
  const payment = debt.paymentHistory.find(item => item.id === paymentId)
  const accountData = loadSavedAccountData(storage)
  if (!accountData) throw new Error('No saved account is available for this payment.')
  const transaction = accountData.transactions.find(item =>
    item.id === payment.transactionId
    && item.linkedDebtPaymentId === paymentId
  )
  if (!transaction) throw new Error('The linked debt payment transaction is unavailable.')

  accountData.transactions = accountData.transactions.filter(item => item.id !== transaction.id)
  debt.paymentHistory = debt.paymentHistory.map(item => item.id === paymentId
    ? { ...item, reversedAt: new Date().toISOString() }
    : item)
  debt.currentBalance = roundMoney(debt.currentBalance + payment.principal)
  updateBalanceReviewFlag(debt)
  saveAccountData(accountData.accounts, accountData.transactions, storage)
  saveDebts(debts, storage)
  return { debt, payment, transaction }
}

export function removeDebtPaymentForTransaction(transactionId, storage = localStorage) {
  const debts = loadDebts(storage)
  let changed = false
  const nextDebts = debts.map(debt => {
    const payment = debt.paymentHistory.find(item =>
      item.transactionId === transactionId && !item.reversedAt
    )
    if (!payment) return debt
    changed = true
    const updatedDebt = {
      ...debt,
      currentBalance: roundMoney(debt.currentBalance + payment.principal),
      paymentHistory: debt.paymentHistory.map(item => item.id === payment.id
        ? { ...item, reversedAt: new Date().toISOString() }
        : item)
    }
    updateBalanceReviewFlag(updatedDebt)
    return updatedDebt
  })
  if (changed) saveDebts(nextDebts, storage)
}

export function reconcileDebtPaymentForTransaction(transactionId, storage = localStorage) {
  const debts = loadDebts(storage)
  const accountData = loadSavedAccountData(storage)
  if (!accountData) return null
  const transaction = accountData.transactions.find(item => item.id === transactionId)
  if (!transaction?.linkedDebtPaymentId) return null
  const debt = debts.find(item => item.id === transaction.linkedDebtId)
  const payment = debt?.paymentHistory.find(item =>
    item.id === transaction.linkedDebtPaymentId && !item.reversedAt
  )
  if (!debt || !payment) return null

  if (transaction.amount >= 0) {
    debt.currentBalance = roundMoney(debt.currentBalance + payment.principal)
    debt.paymentHistory = debt.paymentHistory.map(item => item.id === payment.id
      ? {
        ...item,
        reversedAt: new Date().toISOString(),
        correction: { amount: transaction.amount, date: transaction.date }
      }
      : item)
    updateBalanceReviewFlag(debt)
    delete transaction.linkedDebtId
    delete transaction.linkedDebtPaymentId
    delete transaction.transactionType
    saveAccountData(accountData.accounts, accountData.transactions, storage)
    saveDebts(debts, storage)
    return { debt, payment, reversed: true }
  }

  const total = roundMoney(Math.abs(transaction.amount))
  const availableBeforePayment = roundMoney(debt.currentBalance + payment.principal)
  const calculationMethod = payment.calculationMethod ?? getDebtPaymentCalculationMethod(debt)
  const principal = payment.automaticPrincipal
    ? calculationMethod === DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY
      ? Math.min(total, availableBeforePayment)
      : 0
    : Math.min(payment.principal, total)
  const balanceReviewRequired = payment.automaticPrincipal
    && calculationMethod === DEBT_PAYMENT_CALCULATION_METHODS.MANUAL_PRINCIPAL
  if (
    payment.total === total
    && payment.date === transaction.date
    && payment.principal === principal
    && payment.balanceReviewRequired === balanceReviewRequired
  ) return { debt, payment, changed: false }

  const corrections = [...(payment.corrections ?? []), {
    total: payment.total,
    principal: payment.principal,
    date: payment.date,
    changedAt: new Date().toISOString()
  }]
  debt.currentBalance = roundMoney(Math.max(0, availableBeforePayment - principal))
  debt.paymentHistory = debt.paymentHistory.map(item => item.id === payment.id
    ? {
      ...item,
      total,
      principal,
      balanceReviewRequired,
      calculationMethod,
      date: transaction.date,
      corrections
    }
    : item)
  updateBalanceReviewFlag(debt)
  saveDebts(debts, storage)
  return { debt, payment, changed: true }
}

export function getDebtTypes() {
  return [...DEBT_TYPES]
}
