import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadSavedAccountData, saveAccountData } from './accountStorage.js'
import {
  DEBT_STORAGE_KEY,
  applyPrincipalOnlyToReviewPayments,
  calculateDebtDueDate,
  createDebtPayment,
  debtPaymentNeedsBalanceReview,
  getDebtPaymentCalculationMethod,
  getDebtPrincipalPaid,
  getDebtProgress,
  getDebtRemainingPercent,
  getDebtScheduleStatus,
  loadDebts,
  recordDebtPaymentFromTransaction,
  reconcileDebtPaymentForTransaction,
  removeDebtPaymentForTransaction,
  reverseDebtPayment,
  saveDebts,
  getNextDebtPaymentDue,
  validateDebt
} from './debtData.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
}

function seed(storage) {
  saveAccountData([{
    id: 1,
    name: 'Checking',
    type: 'Checking',
    openingBalance: 2000,
    openingDate: '2026-01-01',
    archived: false
  }], [], storage)
  saveDebts([{
    id: 7,
    name: 'Auto loan',
    type: 'Auto Loan',
    startingBalance: 10000,
    currentBalance: 8000,
    interestRate: 6.5,
    minimumPayment: 300,
    paymentDueDay: 15,
    accountId: 1,
    linkedAccountId: 2,
    billId: 11,
    paymentHistory: []
  }], storage)
}

test('monthly due dates preserve the chosen day across short months', () => {
  assert.equal(calculateDebtDueDate('2026-01-31', 0), '2026-01-31')
  assert.equal(calculateDebtDueDate('2026-01-31', 1), '2026-02-28')
  assert.equal(calculateDebtDueDate('2026-01-31', 2), '2026-03-31')
  assert.equal(calculateDebtDueDate('2028-01-31', 1), '2028-02-29')
  assert.equal(getNextDebtPaymentDue({ paymentDueDay: 15 }, '2026-04-15'), '2026-04-15')
  assert.equal(getNextDebtPaymentDue({ paymentDueDay: 15 }, '2026-04-16'), '2026-05-15')
})

test('linked debt schedule advances on early payment and tracks due today without waiting for clearing', () => {
  const storage = createStorage()
  seed(storage)
  const debt = loadDebts(storage)[0]
  debt.billId = 11
  saveDebts([debt], storage)
  const bill = {
    id: 11,
    debtId: 7,
    name: 'Auto loan',
    amount: 24,
    dueDate: '2026-11-08',
    frequency: 'monthly',
    accountId: 1,
    paymentHistory: []
  }
  let status = getDebtScheduleStatus(debt, [bill], [], '2026-11-08')
  assert.equal(status.nextDueDate, '2026-11-08')
  assert.equal(status.isDueToday, true)
  assert.equal(status.isPastDue, false)

  const earlyPayment = {
    id: 31,
    accountId: 1,
    amount: -24,
    name: 'Auto loan',
    date: '2026-11-06',
    cleared: false,
    linkedBillOccurrenceId: 'bill:11:2026-11-08'
  }
  status = getDebtScheduleStatus(debt, [bill], [earlyPayment], '2026-11-07')
  assert.equal(status.nextDueDate, '2026-12-08')
  assert.equal(status.isPastDue, false)
  assert.equal(status.overdueAmount, 0)
  earlyPayment.cleared = true
  status = getDebtScheduleStatus(debt, [bill], [earlyPayment], '2026-11-07')
  assert.equal(status.nextDueDate, '2026-12-08')
})

test('missed months and late payments calculate all unpaid overdue installments and reverse cleanly', () => {
  const storage = createStorage()
  seed(storage)
  const debt = loadDebts(storage)[0]
  debt.billId = 11
  const bill = {
    id: 11,
    debtId: 7,
    name: 'Auto loan',
    amount: 24,
    dueDate: '2026-11-08',
    frequency: 'monthly',
    accountId: 1,
    paymentHistory: []
  }
  const decemberPayment = {
    id: 31,
    accountId: 1,
    amount: -24,
    name: 'Auto loan',
    date: '2026-12-20',
    cleared: false,
    linkedBillOccurrenceId: 'bill:11:2026-12-08'
  }
  let status = getDebtScheduleStatus(debt, [bill], [decemberPayment], '2027-01-10')
  assert.equal(status.nextDueDate, '2026-11-08')
  assert.equal(status.oldestOverdueDate, '2026-11-08')
  assert.equal(status.overdueCount, 2)
  assert.equal(status.overdueAmount, 48)
  assert.equal(status.isPastDue, true)

  const novemberLatePayment = {
    ...decemberPayment,
    id: 32,
    date: '2027-01-09',
    linkedBillOccurrenceId: 'bill:11:2026-11-08'
  }
  const januaryPayment = {
    ...decemberPayment,
    id: 33,
    date: '2027-01-10',
    linkedBillOccurrenceId: 'bill:11:2027-01-08'
  }
  status = getDebtScheduleStatus(debt, [bill], [
    decemberPayment,
    novemberLatePayment,
    januaryPayment
  ], '2027-01-10')
  assert.equal(status.nextDueDate, '2027-02-08')
  assert.equal(status.isPastDue, false)
  assert.equal(status.overdueAmount, 0)

  status = getDebtScheduleStatus(debt, [bill], [decemberPayment], '2027-01-10')
  assert.equal(status.nextDueDate, '2026-11-08')
  assert.equal(status.overdueAmount, 48)
})

test('linked monthly debt schedule preserves month-end dates including February', () => {
  const storage = createStorage()
  seed(storage)
  const debt = loadDebts(storage)[0]
  debt.billId = 11
  const bill = {
    id: 11,
    debtId: 7,
    name: 'Auto loan',
    amount: 24,
    dueDate: '2026-01-31',
    frequency: 'monthly',
    accountId: 1,
    paymentHistory: []
  }
  const januaryPayment = {
    id: 31,
    accountId: 1,
    amount: -24,
    name: 'Auto loan',
    date: '2026-01-30',
    cleared: false,
    linkedBillOccurrenceId: 'bill:11:2026-01-31'
  }
  const status = getDebtScheduleStatus(debt, [bill], [januaryPayment], '2026-03-01')
  assert.equal(status.nextDueDate, '2026-02-28')
  assert.equal(status.oldestOverdueDate, '2026-02-28')
  assert.equal(status.overdueAmount, 24)
})

test('skipped debt installments are excluded from next due and overdue calculations only for that occurrence', () => {
  const debt = {
    id: 7,
    name: 'Auto loan',
    billId: 11,
    nextPaymentDue: '2026-09-08',
    paymentHistory: []
  }
  const bill = {
    id: 11,
    debtId: 7,
    name: 'Auto loan',
    amount: 24,
    dueDate: '2026-09-08',
    frequency: 'monthly',
    paymentHistory: [{
      dueDate: '2026-10-08',
      skipped: true,
      changedAt: '2026-10-07T12:00:00Z'
    }]
  }

  const status = getDebtScheduleStatus(debt, [bill], [], '2026-11-10')
  assert.equal(status.nextDueDate, '2026-09-08')
  assert.equal(status.oldestOverdueDate, '2026-09-08')
  assert.equal(status.overdueCount, 2)
  assert.equal(status.overdueAmount, 48)
  assert.equal(status.isPastDue, true)
})

test('debt edits preserve legacy links, payment history, and principal calculations', () => {
  const storage = createStorage()
  seed(storage)
  createDebtPayment(7, 'manual:7:1', {
    total: 400,
    principal: 250,
    interest: 120,
    fees: 10,
    date: '2026-04-15'
  }, storage)

  const saved = loadDebts(storage)
  const edited = validateDebt({
    ...saved[0],
    name: 'Refinanced auto loan',
    currentBalance: 7700
  })

  edited.nextPaymentDue = '2026-05-15'
  saveDebts([edited], storage)
  const reloaded = loadDebts(storage)

  assert.equal(reloaded[0].name, 'Refinanced auto loan')
  assert.equal(reloaded[0].paymentDueDay, 15)
  assert.equal(reloaded[0].accountId, 1)
  assert.equal(reloaded[0].linkedAccountId, 2)
  assert.equal(reloaded[0].billId, 11)
  assert.equal(reloaded[0].nextPaymentDue, '2026-05-15')
  assert.equal(reloaded[0].paymentHistory.length, 1)
  assert.equal(getDebtPrincipalPaid(reloaded[0]), 250)
  assert.equal(getDebtProgress(reloaded[0]), 23)
  assert.equal(getDebtRemainingPercent(reloaded[0]), 77)
  assert.equal(getDebtRemainingPercent({ startingBalance: 100, currentBalance: 120 }), 100)
  assert.equal(getDebtRemainingPercent({ startingBalance: 100, currentBalance: -5 }), 0)
})

test('direct debt payments create one uncleared expense and reduce balance by principal only', () => {
  const storage = createStorage()
  seed(storage)
  const details = {
    total: 400,
    principal: 250,
    interest: 120,
    fees: 10,
    date: '2026-04-15'
  }
  const first = createDebtPayment(7, 'manual:7:2', details, storage)
  const repeated = createDebtPayment(7, 'manual:7:2', details, storage)
  const debts = loadDebts(storage)
  const transactions = loadSavedAccountData(storage).transactions

  assert.equal(first.id, repeated.id)
  assert.equal(transactions.length, 1)
  assert.equal(transactions[0].amount, -400)
  assert.equal(transactions[0].cleared, false)
  assert.equal(transactions[0].transactionType, 'debt-payment')
  assert.equal(debts[0].currentBalance, 7750)
  assert.equal(debts[0].paymentHistory.length, 1)
  assert.equal(debts[0].paymentHistory[0].total, 400)
  assert.equal(debts[0].paymentHistory[0].interest, 120)
  assert.equal(debts[0].paymentHistory[0].fees, 10)

  const accountData = loadSavedAccountData(storage)
  accountData.transactions[0].cleared = true
  saveAccountData(accountData.accounts, accountData.transactions, storage)
  assert.equal(loadDebts(storage)[0].currentBalance, 7750)
  assert.equal(loadDebts(storage)[0].paymentHistory.length, 1)
})

test('bill-linked debt payments reuse the bill transaction and are idempotent', () => {
  const storage = createStorage()
  seed(storage)
  const accountData = loadSavedAccountData(storage)
  accountData.transactions.push({
    id: 12,
    sequence: 12,
    accountId: 1,
    name: 'Auto loan payment',
    amount: -400,
    date: '2026-04-15',
    cleared: false,
    linkedOccurrenceType: 'bill',
    linkedOccurrenceId: 'bill:9:2026-04-15',
    linkedBillOccurrenceId: 'bill:9:2026-04-15'
  })

  saveAccountData(accountData.accounts, accountData.transactions, storage)
  const details = {
    date: '2026-04-15',
    principal: 300,
    interest: 100,
    fees: 0,
    billOccurrenceId: 'bill:9:2026-04-15'
  }
  recordDebtPaymentFromTransaction(7, 12, details, storage)
  recordDebtPaymentFromTransaction(7, 12, details, storage)

  const savedAccounts = loadSavedAccountData(storage)
  const debt = loadDebts(storage)[0]
  assert.equal(savedAccounts.transactions.length, 1)
  assert.equal(savedAccounts.transactions[0].linkedBillOccurrenceId, 'bill:9:2026-04-15')
  assert.equal(savedAccounts.transactions[0].linkedDebtId, 7)
  assert.equal(debt.currentBalance, 7700)
  assert.equal(debt.paymentHistory.length, 1)
})

test('principal-only linked payments reduce balance immediately and remain independent of clearing', () => {
  const storage = createStorage()
  seed(storage)
  saveDebts(loadDebts(storage).map(debt => ({
    ...debt,
    startingBalance: 200,
    currentBalance: 100,
    interestRate: 35,
    paymentCalculationMethod: 'principal-only'
  })), storage)
  const accountData = loadSavedAccountData(storage)
  accountData.transactions.push({
    id: 12,
    sequence: 12,
    accountId: 1,
    name: 'Test debt payment',
    amount: -24,
    date: '2026-04-15',
    cleared: false
  })
  saveAccountData(accountData.accounts, accountData.transactions, storage)

  const payment = recordDebtPaymentFromTransaction(7, 12, {
    date: '2026-04-15',
    principal: null,
    automaticPrincipal: true,
    billOccurrenceId: 'bill:9:2026-04-15'
  }, storage)
  let debt = loadDebts(storage)[0]
  assert.equal(payment.principal, 24)
  assert.equal(debt.currentBalance, 76)
  assert.equal(getDebtProgress(debt), 62)
  assert.equal(getDebtRemainingPercent(debt), 38)
  assert.equal(debt.balanceNeedsReview, false)

  for (const cleared of [true, false]) {
    const updatedAccountData = loadSavedAccountData(storage)
    updatedAccountData.transactions[0].cleared = cleared
    saveAccountData(updatedAccountData.accounts, updatedAccountData.transactions, storage)
    debt = loadDebts(storage)[0]
    assert.equal(debt.currentBalance, 76)
    assert.equal(debt.paymentHistory.length, 1)
  }

  debt = loadDebts(storage)[0]
  assert.equal(debt.currentBalance, 76)
  assert.equal(loadSavedAccountData(storage).transactions.length, 1)
  reverseDebtPayment(payment.id, storage)
  debt = loadDebts(storage)[0]
  assert.equal(debt.currentBalance, 100)
  assert.equal(debt.paymentHistory.length, 1)
  assert.ok(debt.paymentHistory[0].reversedAt)
  assert.equal(loadSavedAccountData(storage).transactions.length, 0)
})

test('legacy interest-bearing linked payments flag balance review and restore safely when unlinked', () => {
  const storage = createStorage()
  seed(storage)
  saveDebts(loadDebts(storage).map(debt => ({
    ...debt,
    startingBalance: 200,
    currentBalance: 100,
    interestRate: 35
  })), storage)
  const accountData = loadSavedAccountData(storage)
  accountData.transactions.push({
    id: 12,
    sequence: 12,
    accountId: 1,
    name: 'Test debt payment',
    amount: -24,
    date: '2026-04-15',
    cleared: false
  })
  saveAccountData(accountData.accounts, accountData.transactions, storage)

  const payment = recordDebtPaymentFromTransaction(7, 12, {
    date: '2026-04-15',
    principal: null,
    automaticPrincipal: true,
    billOccurrenceId: 'bill:9:2026-04-15'
  }, storage)
  let debt = loadDebts(storage)[0]
  assert.equal(payment.principal, 0)
  assert.equal(payment.balanceReviewRequired, true)
  assert.equal(debt.currentBalance, 100)
  assert.equal(debt.balanceNeedsReview, true)
  assert.equal(loadDebts(storage)[0].paymentHistory.length, 1)

  removeDebtPaymentForTransaction(12, storage)
  debt = loadDebts(storage)[0]
  assert.equal(debt.currentBalance, 100)
  assert.equal(debt.balanceNeedsReview, false)
  assert.equal(debt.paymentHistory.length, 1)
  assert.ok(debt.paymentHistory[0].reversedAt)
})

test('legacy interest-bearing payment history is flagged without reinterpreting saved balances', () => {
  const storage = createStorage()
  seed(storage)
  const debt = loadDebts(storage)[0]
  debt.startingBalance = 200
  debt.currentBalance = 100
  debt.interestRate = 35
  debt.paymentHistory = [{
    id: '7:1',
    transactionId: 12,
    date: '2026-04-15',
    total: 24,
    principal: 0,
    interest: 0,
    fees: 0,
    automaticPrincipal: true
  }]
  saveDebts([debt], storage)

  const savedDebt = loadDebts(storage)[0]
  assert.equal(getDebtPaymentCalculationMethod(savedDebt), 'manual-principal')
  assert.equal(debtPaymentNeedsBalanceReview(savedDebt, savedDebt.paymentHistory[0]), true)
  assert.equal(savedDebt.currentBalance, 100)
  assert.equal(savedDebt.paymentHistory[0].total, 24)
  assert.equal(savedDebt.paymentHistory[0].calculationMethod, undefined)

  const explicitlyConverted = applyPrincipalOnlyToReviewPayments({
    ...savedDebt,
    paymentCalculationMethod: 'principal-only'
  })
  assert.equal(explicitlyConverted.currentBalance, 76)
  assert.equal(explicitlyConverted.paymentHistory[0].principal, 24)
  assert.equal(explicitlyConverted.paymentHistory[0].balanceReviewRequired, false)
  assert.equal(explicitlyConverted.balanceNeedsReview, false)
  saveDebts([explicitlyConverted], storage)
  assert.equal(loadDebts(storage)[0].currentBalance, 76)
  assert.equal(applyPrincipalOnlyToReviewPayments(loadDebts(storage)[0]).currentBalance, 76)
})

test('correcting a linked transaction recalculates principal and preserves correction history', () => {
  const storage = createStorage()
  seed(storage)
  saveDebts(loadDebts(storage).map(debt => ({ ...debt, interestRate: 0 })), storage)
  const accountData = loadSavedAccountData(storage)
  accountData.transactions.push({
    id: 12,
    sequence: 12,
    accountId: 1,
    name: 'Auto loan payment',
    amount: -200,
    date: '2026-04-15',
    cleared: false,
    linkedOccurrenceType: 'bill',
    linkedOccurrenceId: 'bill:9:2026-04-15',
    linkedBillOccurrenceId: 'bill:9:2026-04-15'
  })
  saveAccountData(accountData.accounts, accountData.transactions, storage)
  recordDebtPaymentFromTransaction(7, 12, {
    date: '2026-04-15',
    principal: 200,
    interest: 0,
    fees: 0,
    automaticPrincipal: true,
    billOccurrenceId: 'bill:9:2026-04-15'
  }, storage)

  const changed = loadSavedAccountData(storage)
  changed.transactions[0].amount = -500
  changed.transactions[0].date = '2026-04-16'
  saveAccountData(changed.accounts, changed.transactions, storage)
  reconcileDebtPaymentForTransaction(12, storage)

  let debt = loadDebts(storage)[0]
  assert.equal(debt.currentBalance, 7500)
  assert.equal(debt.paymentHistory[0].total, 500)
  assert.equal(debt.paymentHistory[0].principal, 500)
  assert.equal(debt.paymentHistory[0].date, '2026-04-16')
  assert.equal(debt.paymentHistory[0].corrections.length, 1)

  const corrected = loadSavedAccountData(storage)
  corrected.transactions[0].amount = 100
  saveAccountData(corrected.accounts, corrected.transactions, storage)
  reconcileDebtPaymentForTransaction(12, storage)
  debt = loadDebts(storage)[0]
  assert.equal(debt.currentBalance, 8000)
  assert.ok(debt.paymentHistory[0].reversedAt)
  assert.equal(loadSavedAccountData(storage).transactions[0].linkedDebtId, undefined)
})

test('debt principal cannot exceed balance and reversing payment restores it', () => {
  const storage = createStorage()
  seed(storage)
  assert.throws(() => createDebtPayment(7, 'manual:7:invalid', {
    total: 9000,
    principal: 9000,
    date: '2026-04-15'
  }, storage), /Principal cannot exceed/)
  assert.equal(loadSavedAccountData(storage).transactions.length, 0)

  createDebtPayment(7, 'manual:7:3', {
    total: 400,
    principal: 250,
    interest: 150,
    fees: 0,
    date: '2026-04-15'
  }, storage)
  const { transaction } = reverseDebtPayment('manual:7:3', storage)
  assert.equal(transaction.id, 1)
  assert.equal(loadSavedAccountData(storage).transactions.length, 0)
  assert.equal(loadDebts(storage)[0].currentBalance, 8000)
  assert.equal(loadDebts(storage)[0].paymentHistory.length, 1)
  assert.ok(loadDebts(storage)[0].paymentHistory[0].reversedAt)
})

test('retry after a debt-save interruption reuses the already-created transaction', () => {
  const storage = createStorage()
  seed(storage)
  let failDebtSave = true
  const interruptedStorage = {
    getItem: storage.getItem,
    setItem(key, value) {
      if (key === DEBT_STORAGE_KEY && failDebtSave) {
        failDebtSave = false
        throw new Error('simulated debt storage interruption')
      }
      storage.setItem(key, value)
    }
  }
  const details = {
    total: 400,
    principal: 250,
    interest: 150,
    fees: 0,
    date: '2026-04-15'
  }
  assert.throws(() => createDebtPayment(7, 'manual:7:retry', details, interruptedStorage))
  assert.equal(loadSavedAccountData(storage).transactions.length, 1)

  createDebtPayment(7, 'manual:7:retry', details, storage)
  assert.equal(loadSavedAccountData(storage).transactions.length, 1)
  assert.equal(loadDebts(storage)[0].paymentHistory.length, 1)
  assert.equal(loadDebts(storage)[0].currentBalance, 7750)
})
