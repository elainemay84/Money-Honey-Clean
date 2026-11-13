import { loadSavedAccountData, saveAccountData } from './accountStorage.js'
import {
  createBillId,
  getBillOccurrencesInRange,
  loadBillData,
  saveBillData
} from './billData.js'

export const DEBT_STORAGE_KEY = 'money-honey-debts'
export const DEBT_STORAGE_VERSION = 1

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

export function loadDebts(storage = localStorage) {
  const saved = storage.getItem(DEBT_STORAGE_KEY)
  if (saved === null) return []

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
  return data.debts
}

export function saveDebts(debts, storage = localStorage) {
  assertDebts(debts)
  storage.setItem(DEBT_STORAGE_KEY, JSON.stringify({
    version: DEBT_STORAGE_VERSION,
    debts
  }))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('money-honey-debts-updated'))
  }
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
  const bill = bills.find(item => item.id === debt.billId && item.debtId === debt.id)
    ?? bills.find(item => item.debtId === debt.id)
    ?? bills.find(item => item.id === debt.billId && item.debtId == null)
  if (!bill || !validISODate(bill.dueDate) || bill.archived || bill.active === false) {
    const nextDueDate = getNextDebtPaymentDue(debt, today)
    const pastDue = validISODate(nextDueDate) && nextDueDate < today
    return {
      nextDueDate,
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
    overdueAmount: roundMoney(overdueOccurrences.reduce((sum, occurrence) => sum + Math.abs(occurrence.amount), 0)),
    overdueCount: overdueOccurrences.length,
    oldestOverdueDate: overdueOccurrences[0]?.dueDate ?? null,
    isPastDue: overdueOccurrences.length > 0,
    isDueToday: !overdueOccurrences.length && nextUnpaid?.dueDate === today
  }
}

export function getNextDebtPaymentDue(debt, today = new Date().toLocaleDateString('en-CA')) {
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
  return Number.isFinite(debt.minimumPayment)
    && debt.minimumPayment > 0
    && calculateDebtDueDate(debt.nextPaymentDue, 0) === debt.nextPaymentDue
}

export function getMatchingDebtBill(bills, debt) {
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

function updateDebtSchedule(bill, debt, managed) {
  return {
    ...bill,
    name: debt.name,
    amount: debt.minimumPayment,
    dueDate: debt.nextPaymentDue,
    frequency: 'monthly',
    debtId: debt.id,
    debtManaged: managed,
    ...(managed ? { active: true, archived: false } : {}),
    occurrenceOverrides: preserveDebtBillHistory(bill)
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
    bills = [...bills, {
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
    }]
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

  const { billOccurrenceId, scheduledDueDate } = getLinkedBillOccurrence(transaction, details)
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
    billOccurrenceId
  }
  transaction.linkedDebtId = debt.id
  transaction.linkedDebtPaymentId = payment.id
  transaction.transactionType = 'debt-payment'
  debt.paymentHistory = [...debt.paymentHistory, payment]
  debt.currentBalance = roundMoney(Math.max(0, debt.currentBalance - payment.principal))
  updateBalanceReviewFlag(debt)
  saveAccountData(accountData.accounts, accountData.transactions, storage)
  saveDebts(debts, storage)
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
  const payment = {
    id: paymentId,
    sequence: debt.paymentHistory.length + 1,
    transactionId: id,
    date: details.date,
    total,
    ...allocation,
    billOccurrenceId: null
  }
  if (!existingTransaction) {
    accountData.transactions.push({
      id,
      sequence,
      accountId,
      name: `Debt payment · ${debt.name}`,
      amount: -total,
      date: details.date,
      cleared: false,
      category: 'Debt Payments',
      linkedDebtId: debt.id,
      linkedDebtPaymentId: paymentId,
      transactionType: 'debt-payment'
    })
  }
  debt.paymentHistory = [...debt.paymentHistory, payment]
  debt.currentBalance = roundMoney(Math.max(0, debt.currentBalance - payment.principal))
  updateBalanceReviewFlag(debt)
  saveAccountData(accountData.accounts, accountData.transactions, storage)
  saveDebts(debts, storage)
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
