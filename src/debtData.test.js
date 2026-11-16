import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOccurrenceTransaction, loadSavedAccountData, saveAccountData } from './accountStorage.js'
import { getBillOccurrencesInRange, loadBillData, saveBillData, updateBillOccurrenceSkip, updateScheduleOccurrence } from './billData.js'
import { createPaymentPlan, createPayInFourSchedule, createRecurringSchedule, generatePaymentPlan, getDebtInstallmentProgress, getDebtScheduledPayments, scheduleFromForm, validatePaymentSchedule } from './debtSchedule.js'
import { SANITIZERS } from './backupSanitize.js'
import { getIncomeVsExpenses, getSpendingByCategory } from './reportData.js'
import {
  DEBT_STORAGE_KEY,
  addDebtAssignee,
  applyPrincipalOnlyToReviewPayments,
  calculateDebtDueDate,
  calculateOverallDebtSummary,
  createDebtPayment,
  debtPaymentNeedsBalanceReview,
  deleteDebt,
  deleteDebtAssignee,
  getDebtPaymentCalculationMethod,
  getDebtPrincipalPaid,
  getDebtProgress,
  getAvailableCredit,
  getDebtAssignee,
  getDebtRemainingPercent,
  getDebtScheduleStatus,
  loadDebts,
  loadDebtData,
  recordDebtPaymentFromTransaction,
  reconcileDebtPaymentForTransaction,
  removeDebtPaymentForTransaction,
  reverseDebtPayment,
  renameDebtAssignee,
  renameDebtPurchaseCategory,
  saveDebts,
  synchronizeDebtBills,
  getNextDebtPaymentDue,
  validateDebt
} from './debtData.js'

function installmentDebt(changes = {}) {
  return {
    id: 7, name: 'The Home Depot', type: 'Other', startingBalance: 1780.64, currentBalance: 296.74,
    minimumPayment: null, interestRate: 24.99, accountId: 1, nextPaymentDue: '2026-11-16', paymentHistory: [],
    paymentSchedule: {
      kind: 'custom', frequency: 'biweekly', startDate: '2026-11-16',
      completedInstallments: 5, totalInstallments: 6, remainingTotal: 296.74
    },
    ...changes
  }
}

test('generated explicit plans divide cents evenly and preserve calendar anchors', () => {
  const example = generatePaymentPlan('188.28', 4, '2026-11-20', 'biweekly')
  assert.deepEqual(example.installments.map(row => [row.dueDate, row.amount]), [
    ['2026-11-20', 47.07], ['2026-12-04', 47.07], ['2026-12-18', 47.07], ['2027-01-01', 47.07]
  ])
  const biweekly = generatePaymentPlan('100.03', '4', '2026-12-25', 'biweekly')
  assert.deepEqual(biweekly.installments.map(row => [row.dueDate, row.amount]), [
    ['2026-12-25', 25.01], ['2027-01-08', 25.01], ['2027-01-22', 25.01], ['2027-02-05', 25]
  ])
  const monthly = generatePaymentPlan('99.99', 4, '2028-01-31', 'monthly')
  assert.deepEqual(monthly.installments.map(row => row.dueDate), ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'])
  for (const [frequency, dates] of [
    ['quarterly', ['2026-11-30', '2027-02-28', '2027-05-30']],
    ['semiannual', ['2026-11-30', '2027-05-30', '2027-11-30']],
    ['annual', ['2026-11-30', '2027-11-30', '2028-11-30']]
  ]) {
    assert.deepEqual(generatePaymentPlan('75', 3, dates[0], frequency).installments.map(row => row.dueDate), dates)
  }
  for (const [balance, count] of [['0.05', 4], ['99.99', 4], ['1,000,000.01', 13], ['6.01', 600]]) {
    const plan = generatePaymentPlan(balance, count, '2026-11-16', 'weekly')
    const cents = plan.installments.map(row => Math.round(row.amount * 100))
    assert.equal(cents.reduce((sum, amount) => sum + amount, 0), Math.round(Number(balance.replaceAll(',', '')) * 100))
    assert.ok(Math.max(...cents) - Math.min(...cents) <= 1)
    assert.equal(plan.completedInstallments, 0)
    validatePaymentSchedule(plan)
  }
  for (const args of [
    ['', 4, '2026-11-16'], ['0.03', 4, '2026-11-16'], ['100', 0, '2026-11-16'],
    ['100', 601, '2026-11-16'], ['100', '2.5', '2026-11-16'],
    ['100', 4, '2026-02-30'], ['100', 4, ''], ['100', 4, '2026-11-16', 'unknown']
  ]) assert.throws(() => generatePaymentPlan(...args))
})

test('generated plans synchronize once and Bills payments reduce the balance exactly once', () => {
  const storage = createStorage()
  saveAccountData([{ id: 1, name: 'Checking', openingBalance: 1000 }], [], storage)
  const paymentSchedule = generatePaymentPlan('100.03', 4, '2026-11-16', 'biweekly')
  saveDebts([installmentDebt({ currentBalance: 100.03, interestRate: 0, paymentSchedule })], storage)
  synchronizeDebtBills(storage)
  const { bills } = synchronizeDebtBills(storage)
  assert.equal(bills.length, 1)
  const occurrences = getBillOccurrencesInRange(bills, '2026-01-01', '2028-01-01')
  assert.deepEqual(occurrences.map(row => [row.dueDate, row.amount]), paymentSchedule.installments.map(row => [row.dueDate, row.amount]))
  for (const occurrence of occurrences) {
    const { transaction } = createOccurrenceTransaction('out', occurrence, occurrence.dueDate, storage)
    assert.equal(createOccurrenceTransaction('out', occurrence, occurrence.dueDate, storage).transaction.id, transaction.id)
    const details = { billOccurrenceId: occurrence.occurrenceId, scheduledDueDate: occurrence.scheduledDate }
    recordDebtPaymentFromTransaction(7, transaction.id, details, storage)
    recordDebtPaymentFromTransaction(7, transaction.id, details, storage)
    synchronizeDebtBills(storage)
  }
  assert.equal(loadDebts(storage)[0].currentBalance, 0)
  assert.equal(loadDebts(storage)[0].paymentHistory.length, 4)
  assert.equal(loadSavedAccountData(storage).transactions.length, 4)
})

test('explicit plans preserve unequal dates, completed rows, linked payments, reporting, and backup metadata', () => {
  const storage = createStorage()
  const accounts = [{ id: 1, name: 'Main Checking', type: 'Checking', isMain: true, openingBalance: 2000 }]
  const purchase = { id: 1, accountId: 1, name: 'Original purchase', amount: -100, category: 'Shopping', date: '2026-11-01', cleared: true }
  saveAccountData(accounts, [purchase], storage)
  const schedule = createPaymentPlan([
    { dueDate: '2026-11-01', amount: '20', paid: true },
    { dueDate: '2026-11-16', amount: '29.99', paid: false },
    { dueDate: '2026-12-19', amount: '50.01', paid: false }
  ])
  validatePaymentSchedule(schedule)
  saveDebts([installmentDebt({
    name: 'Klarna - Store', provider: 'Klarna', merchant: 'Store', purchaseCategory: 'Shopping',
    startingBalance: 100, currentBalance: 80, interestRate: 0, paymentSchedule: schedule
  })], storage)
  let { bills, debts } = synchronizeDebtBills(storage)
  let transactions = loadSavedAccountData(storage).transactions
  let occurrences = getBillOccurrencesInRange(bills, '2026-01-01', '2028-12-31', transactions)
  assert.deepEqual(occurrences.map(row => [row.dueDate, row.amount]), [['2026-11-16', 29.99], ['2026-12-19', 50.01]])
  assert.equal(transactions.length, 1)
  assert.equal(debts[0].paymentHistory.length, 0)
  assert.deepEqual(getDebtInstallmentProgress(debts[0]), { completed: 1, total: 3, remaining: 2 })
  for (const occurrence of occurrences) {
    const paymentDate = occurrence.dueDate === '2026-11-16' ? '2026-11-15' : '2026-11-30'
    const first = createOccurrenceTransaction('out', occurrence, paymentDate, storage)
    const repeated = createOccurrenceTransaction('out', occurrence, paymentDate, storage)
    assert.equal(first.transaction.id, repeated.transaction.id)
    const details = { billOccurrenceId: occurrence.occurrenceId, scheduledDueDate: occurrence.scheduledDate }
    const payment = recordDebtPaymentFromTransaction(7, first.transaction.id, details, storage)
    assert.deepEqual(recordDebtPaymentFromTransaction(7, first.transaction.id, details, storage), payment)
    assert.equal(payment.date, paymentDate)
  }
  ;({ bills, debts } = synchronizeDebtBills(storage))
  transactions = loadSavedAccountData(storage).transactions
  assert.equal(transactions.length, 3)
  assert.equal(debts[0].paymentHistory.length, 2)
  assert.equal(debts[0].currentBalance, 0)
  assert.deepEqual(getDebtInstallmentProgress(debts[0]), { completed: 3, total: 3, remaining: 0 })
  assert.equal(getBillOccurrencesInRange(bills, '2026-01-01', '2028-12-31', transactions).filter(row => !row.paid).length, 0)
  assert.equal(transactions[0].cleared, true)
  assert.equal(transactions[1].cleared, false)
  assert.deepEqual(loadSavedAccountData(storage).accounts, accounts)
  const args = { transactions, month: '2026-11', categories: ['Shopping', 'Debt Payments'], accounts }
  assert.equal(getSpendingByCategory(args).total, 100)
  assert.equal(getIncomeVsExpenses(args).debtPayments, 80)
  assert.equal(getSpendingByCategory({ ...args, transactions: transactions.slice(1) }).total, 0)
  const restored = JSON.parse(SANITIZERS[DEBT_STORAGE_KEY](storage.getItem(DEBT_STORAGE_KEY)))
  assert.deepEqual(restored.debts, debts)
  renameDebtPurchaseCategory('Shopping', 'Gifts', storage)
  assert.equal(loadDebts(storage)[0].purchaseCategory, 'Gifts')
  assert.deepEqual(loadDebts(storage)[0].paymentHistory, debts[0].paymentHistory)
  assert.deepEqual(loadSavedAccountData(storage).transactions, transactions)
  removeDebtPaymentForTransaction(transactions[1].id, storage)
  assert.equal(loadDebts(storage)[0].currentBalance, 29.99)
  assert.equal(getDebtInstallmentProgress(loadDebts(storage)[0]).completed, 2)
})

test('explicit plans reject missing or duplicate dates and invalid amounts instead of generating payments', () => {
  for (const rows of [
    [], [{ dueDate: '', amount: 10 }], [{ dueDate: '2026-02-30', amount: 10 }],
    [{ dueDate: '2026-11-16', amount: 0 }],
    [{ dueDate: '2026-11-16', amount: 10 }, { dueDate: '2026-11-16', amount: 20 }]
  ]) assert.throws(() => validatePaymentSchedule(createPaymentPlan(rows)))
  assert.throws(() => createPaymentPlan([{ dueDate: '2026-11-16', amount: '' }]))
  const paymentSchedule = createPaymentPlan([{ dueDate: '2026-11-16', amount: 10, paid: true }])
  const debt = installmentDebt({ paymentSchedule, currentBalance: 0 })
  assert.deepEqual(getDebtScheduledPayments(debt), [])
  assert.equal(getNextDebtPaymentDue(debt), '')
  assert.deepEqual(getDebtInstallmentProgress(debt), { completed: 1, total: 1, remaining: 0 })
})

test('explicit plan edits preserve occurrence links and respect bill-only date and amount changes', () => {
  const storage = createStorage()
  const schedule = createPaymentPlan([
    { dueDate: '2026-11-16', amount: 10 }, { dueDate: '2026-12-16', amount: 20 }
  ])
  saveDebts([installmentDebt({ paymentSchedule: schedule })], storage)
  let { bills, debts } = synchronizeDebtBills(storage)
  const bill = updateScheduleOccurrence(bills[0], '2026-11-16', { dueDate: '2026-11-18', amount: 12, debtAmountOverride: true })
  saveBillData({ bills: [bill] }, storage)
  ;({ bills, debts } = synchronizeDebtBills(storage))
  assert.equal(bills[0].occurrenceOverrides[0].dueDate, '2026-11-18')
  assert.equal(bills[0].occurrenceOverrides[0].amount, 12)
  debts[0].paymentSchedule = createPaymentPlan(schedule.installments.map((row, index) => index ? row : { ...row, dueDate: '2026-11-20', amount: 15 }))
  saveDebts(debts, storage)
  ;({ bills } = synchronizeDebtBills(storage))
  assert.equal(bills[0].occurrenceOverrides[0].scheduledDate, '2026-11-16')
  assert.equal(bills[0].occurrenceOverrides[0].dueDate, '2026-11-20')
  assert.equal(bills[0].occurrenceOverrides[0].amount, 15)
})

test('four automatic biweekly payments total the exact balance and progress once per payment through completion', () => {
  const storage = createStorage()
  saveAccountData([{ id: 1, name: 'Checking', openingBalance: 2000 }], [], storage)
  const debt = installmentDebt({ currentBalance: 100.03, interestRate: 0, paymentSchedule: createPayInFourSchedule('100.03', '2026-11-16') })
  const slots = getDebtScheduledPayments(debt)
  assert.deepEqual(slots.map(item => [item.dueDate, item.amount]), [
    ['2026-11-16', 25], ['2026-11-30', 25], ['2026-12-14', 25], ['2026-12-28', 25.03]
  ])
  assert.equal(slots.reduce((sum, item) => sum + Math.round(item.amount * 100), 0), 10003)
  saveDebts([debt], storage)
  for (let index = 0; index < slots.length; index += 1) {
    let { debts, bills } = synchronizeDebtBills(storage)
    const status = getDebtScheduleStatus(debts[0], bills, loadSavedAccountData(storage).transactions, '2026-11-15')
    assert.equal(status.nextPaymentAmount, slots[index].amount)
    assert.equal(status.nextDueDate, slots[index].dueDate)
    const payment = { total: slots[index].amount, principal: slots[index].amount, accountId: 1, date: slots[index].dueDate }
    createDebtPayment(7, `automatic:${index}`, payment, storage)
    createDebtPayment(7, `automatic:${index}`, payment, storage)
    ;({ debts, bills } = synchronizeDebtBills(storage))
    const transactions = loadSavedAccountData(storage).transactions
    assert.equal(transactions.length, index + 1)
    assert.equal(debts[0].paymentHistory.length, index + 1)
    assert.equal(getDebtInstallmentProgress(debts[0]).completed, index + 1)
    assert.equal(getBillOccurrencesInRange(bills, '2026-01-01', '2027-01-01', transactions).length, 4)
    assert.deepEqual(debts[0].paymentSchedule, debt.paymentSchedule)
  }
  const { debts, bills } = synchronizeDebtBills(storage)
  const finalStatus = getDebtScheduleStatus(debts[0], bills, loadSavedAccountData(storage).transactions)
  assert.equal(debts[0].currentBalance, 0)
  assert.equal(finalStatus.nextDueDate, '')
  assert.equal(finalStatus.nextPaymentAmount, null)
})

test('simple Pay in 4 setup validates its two inputs and assigns cent remainders only to the last payment', () => {
  for (const [balance, amounts] of [['99.99', [24.99, 24.99, 24.99, 25.02]], ['0.05', [0.01, 0.01, 0.01, 0.02]], ['1,000,000.01', [250000, 250000, 250000, 250000.01]]]) {
    const paymentSchedule = createPayInFourSchedule(balance, '2026-12-25')
    validatePaymentSchedule(paymentSchedule)
    const payments = getDebtScheduledPayments({ paymentSchedule })
    assert.deepEqual(payments.map(item => item.amount), amounts)
    assert.deepEqual(payments.map(item => item.dueDate), ['2026-12-25', '2027-01-08', '2027-01-22', '2027-02-05'])
  }
  for (const balance of ['', '-1', '1.234', '0', '0.03']) {
    assert.throws(() => createPayInFourSchedule(balance, '2026-11-16'), /Current balance/)
  }
  for (const date of ['', '2026-02-30']) {
    assert.throws(() => createPayInFourSchedule('100', date), /first payment due date/)
  }
})

test('installment schedules generate only unpaid baseline installments, record once, and reverse without losing plan data', () => {
  const storage = createStorage()
  saveAccountData([{ id: 1, name: 'Checking', openingBalance: 2000 }], [], storage)
  saveDebts([installmentDebt()], storage)
  let { debts, bills } = synchronizeDebtBills(storage)
  const occurrences = getBillOccurrencesInRange(bills, '2026-01-01', '2027-12-31')
  assert.equal(occurrences.length, 1)
  assert.equal(occurrences[0].amount, 296.74)
  assert.deepEqual(getDebtInstallmentProgress(debts[0]), { completed: 5, total: 6, remaining: 1 })
  assert.equal(debts[0].paymentHistory.length, 0)
  const details = { total: 296.74, principal: 296.74, date: '2026-11-15', accountId: 1 }
  createDebtPayment(7, 'installment:6', details, storage)
  createDebtPayment(7, 'installment:6', details, storage)
  ;({ debts, bills } = synchronizeDebtBills(storage))
  const transactions = loadSavedAccountData(storage).transactions
  assert.equal(transactions.length, 1)
  assert.equal(getBillOccurrencesInRange(bills, '2026-01-01', '2027-12-31', transactions).filter(item => !item.paid).length, 0)
  assert.equal(getDebtScheduleStatus(debts[0], bills, transactions, '2026-11-15').nextDueDate, '')
  assert.deepEqual(getDebtInstallmentProgress(debts[0]), { completed: 6, total: 6, remaining: 0 })
  reverseDebtPayment('installment:6', storage)
  assert.equal(loadDebts(storage)[0].currentBalance, 296.74)
  assert.equal(getNextDebtPaymentDue(loadDebts(storage)[0]), '2026-11-16')
  assert.equal(loadDebts(storage)[0].paymentSchedule.completedInstallments, 5)
})

test('Pay in 4 preserves completed baselines, cent remainders and skipped installments without extending the plan', () => {
  const storage = createStorage()
  const debt = installmentDebt({ currentBalance: 75.01, paymentSchedule: {
    kind: 'pay-in-4', frequency: 'biweekly', startDate: '2026-11-16',
    completedInstallments: 1, totalInstallments: 4, remainingTotal: 75.01
  } })
  const slots = getDebtScheduledPayments(debt)
  assert.deepEqual(slots.map(item => item.amount), [25, 25, 25.01])
  assert.deepEqual(slots.map(item => item.dueDate), ['2026-11-16', '2026-11-30', '2026-12-14'])
  assert.equal(slots.reduce((sum, item) => sum + Math.round(item.amount * 100), 0), 7501)
  saveDebts([debt], storage)
  let { debts, bills } = synchronizeDebtBills(storage)
  bills[0] = updateBillOccurrenceSkip(bills[0], '2026-11-16', true)
  saveBillData({ bills }, storage)
  assert.equal(getDebtScheduleStatus(debts[0], bills, [], '2026-11-17').nextDueDate, '2026-11-30')
  assert.equal(getDebtInstallmentProgress(debts[0]).completed, 1)
  assert.equal(loadDebts(storage)[0].currentBalance, 75.01)
  synchronizeDebtBills(storage)
  bills = loadBillData([], storage).bills
  assert.equal(getBillOccurrencesInRange(bills, '2026-01-01', '2027-12-31').length, 3)
  bills[0] = updateScheduleOccurrence(updateBillOccurrenceSkip(bills[0], '2026-11-16', false), '2026-11-16', { dueDate: '2026-11-20' })
  saveBillData({ bills }, storage)
  ;({ debts, bills } = synchronizeDebtBills(storage))
  assert.equal(getDebtScheduleStatus(debts[0], bills, [], '2026-11-17').nextDueDate, '2026-11-20')
  assert.equal(getBillOccurrencesInRange(bills, '2026-11-20', '2026-11-20')[0].occurrenceId, `bill:${bills[0].id}:2026-11-16`)
  bills[0] = updateBillOccurrenceSkip(bills[0], '2026-11-30', true)
  saveBillData({ bills }, storage)
  debts[0].paymentSchedule.frequency = 'monthly'
  saveDebts(debts, storage)
  ;({ bills } = synchronizeDebtBills(storage))
  const adjusted = getBillOccurrencesInRange(bills, '2026-01-01', '2027-12-31')
  assert.equal(adjusted.length, 3)
  assert.equal(adjusted.find(item => item.installmentNumber === 3).skipped, true)
  assert.equal(adjusted.find(item => item.installmentNumber === 3).scheduledDate, '2026-11-30')
  bills[0] = updateBillOccurrenceSkip(bills[0], '2026-11-30', false)
  saveBillData({ bills }, storage)
  saveAccountData([{ id: 1, name: 'Checking', openingBalance: 1000 }], [{
    id: 1, accountId: 1, name: debt.name, amount: -25, date: '2026-11-30',
    linkedBillOccurrenceId: `bill:${bills[0].id}:2026-11-30`
  }], storage)
  recordDebtPaymentFromTransaction(7, 1, {}, storage)
  const paidAfterRescheduling = loadDebts(storage)[0]
  assert.equal(paidAfterRescheduling.paymentHistory[0].installmentNumber, 3)
  assert.equal(getDebtInstallmentProgress(paidAfterRescheduling).completed, 2)
})

test('monthly anchors survive short months and custom schedules support exact day intervals and adjusted dates', () => {
  const monthly = installmentDebt({ paymentSchedule: {
    kind: 'monthly', frequency: 'monthly', startDate: '2028-01-31', dueDay: 31, completedInstallments: 0
  } })
  assert.deepEqual(getDebtScheduledPayments(monthly, 3).map(item => item.dueDate), ['2028-01-31', '2028-02-29', '2028-03-31'])
  const custom = installmentDebt({ paymentSchedule: {
    kind: 'custom', frequency: 'days', intervalDays: 10, startDate: '2026-12-25',
    completedInstallments: 0, totalInstallments: 3, remainingTotal: 10,
    dateAdjustments: [{ scheduledDate: '2027-01-04', dueDate: '2027-01-05' }]
  } })
  validatePaymentSchedule(custom.paymentSchedule)
  assert.deepEqual(getDebtScheduledPayments(custom).map(item => [item.dueDate, item.amount]), [
    ['2026-12-25', 3.33], ['2027-01-05', 3.33], ['2027-01-14', 3.34]
  ])
  for (const changes of [{ completedInstallments: 4 }, { intervalDays: 0 }, { installmentAmount: 8 }, { remainingTotal: 1.234 }]) {
    assert.throws(() => validatePaymentSchedule({ ...custom.paymentSchedule, ...changes }))
  }
})

function recurringDebt(frequency, startDate, changes = {}) {
  return installmentDebt({ currentBalance: 1000, minimumPayment: 50, nextPaymentDue: startDate,
    paymentSchedule: scheduleFromForm(createRecurringSchedule(frequency, startDate), startDate), ...changes })
}

test('payment frequencies advance weekly and biweekly by days and longer periods by calendar months', () => {
  const dates = (frequency, start, count = 4) => getDebtScheduledPayments(recurringDebt(frequency, start), count).map(item => item.dueDate)
  assert.deepEqual(dates('weekly', '2026-12-28'), ['2026-12-28', '2027-01-04', '2027-01-11', '2027-01-18'])
  assert.deepEqual(dates('biweekly', '2026-12-28'), ['2026-12-28', '2027-01-11', '2027-01-25', '2027-02-08'])
  assert.deepEqual(dates('monthly', '2027-01-31'), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  assert.deepEqual(dates('quarterly', '2026-11-30'), ['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30'])
  assert.deepEqual(dates('semiannual', '2026-08-31', 3), ['2026-08-31', '2027-02-28', '2027-08-31'])
  assert.deepEqual(dates('annual', '2028-02-29', 3), ['2028-02-29', '2029-02-28', '2030-02-28'])
  const biweekly = recurringDebt('biweekly', '2026-11-16')
  validatePaymentSchedule(biweekly.paymentSchedule)
  assert.equal(biweekly.paymentSchedule.totalInstallments, null)
  assert.equal(getDebtScheduledPayments(biweekly, 12).length, 12)
  assert.equal(getDebtInstallmentProgress(biweekly), null)
})

test('Twice a Month uses two chosen days, clamps short months and requires the next due date on a chosen day', () => {
  const debt = recurringDebt('twice-monthly', '2027-01-15', {
    paymentSchedule: { ...createRecurringSchedule('twice-monthly', '2027-01-15'), daysOfMonth: [31, 15], totalInstallments: null, completedInstallments: 0, dueDay: null }
  })
  debt.paymentSchedule = scheduleFromForm(debt.paymentSchedule, '2027-01-15')
  assert.deepEqual(debt.paymentSchedule.daysOfMonth, [15, 31])
  validatePaymentSchedule(debt.paymentSchedule)
  assert.deepEqual(getDebtScheduledPayments(debt, 6).map(item => item.dueDate),
    ['2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31'])
  validatePaymentSchedule({ ...debt.paymentSchedule, startDate: '2027-02-28' })
  assert.throws(() => validatePaymentSchedule({ ...debt.paymentSchedule, startDate: '2027-01-20' }), /one of the two payment days/)
  for (const daysOfMonth of [[15], [15, 15], [0, 15], [15, 32], undefined]) {
    assert.throws(() => validatePaymentSchedule({ ...debt.paymentSchedule, daysOfMonth }), /two different payment days/)
  }
})

test('recurring frequencies sync to bills, advance after a recorded payment and never mark passed dates paid', () => {
  for (const [frequency, start, billFrequency, expected] of [
    ['biweekly', '2026-11-16', 'biweekly', ['2026-11-16', '2026-11-30', '2026-12-14']],
    ['twice-monthly', '2027-02-15', 'twice-monthly', ['2027-02-15', '2027-02-28', '2027-03-15']],
    ['semiannual', '2026-08-31', 'semiannual', ['2026-08-31', '2027-02-28', '2027-08-31']],
    ['annual', '2028-02-29', 'yearly', ['2028-02-29', '2029-02-28', '2030-02-28']]
  ]) {
    const storage = createStorage()
    saveAccountData([{ id: 1, name: 'Checking', openingBalance: 2000 }], [], storage)
    saveDebts([recurringDebt(frequency, start)], storage)
    let { debts, bills } = synchronizeDebtBills(storage)
    assert.equal(bills[0].frequency, billFrequency)
    assert.deepEqual(getBillOccurrencesInRange(bills, '2026-01-01', '2030-12-31').slice(0, 3).map(item => item.dueDate), expected)
    assert.deepEqual(getDebtScheduledPayments(debts[0], 3).map(item => item.dueDate), expected)
    const later = getDebtScheduleStatus(debts[0], bills, [], expected[2])
    assert.equal(later.nextDueDate, expected[0])
    assert.equal(later.overdueCount, 2)
    assert.equal(loadDebts(storage)[0].currentBalance, 1000)
    assert.equal(loadDebts(storage)[0].paymentHistory.length, 0)
    createDebtPayment(7, `paid:${frequency}`, { total: 50, principal: 50, accountId: 1, date: start }, storage)
    ;({ debts, bills } = synchronizeDebtBills(storage))
    assert.equal(debts[0].currentBalance, 950)
    assert.equal(getNextDebtPaymentDue(debts[0]), expected[1])
    assert.equal(getDebtScheduleStatus(debts[0], bills, loadSavedAccountData(storage).transactions, start).nextDueDate, expected[1])
  }
})

test('existing Pay in 4 plans and legacy schedules load unchanged without extra or open-ended payments', () => {
  const storage = createStorage()
  const payInFour = { kind: 'pay-in-4', frequency: 'biweekly', startDate: '2026-11-30', completedInstallments: 2, totalInstallments: 4, remainingTotal: 50.01 }
  const legacyMonthly = { kind: 'monthly', frequency: 'monthly', startDate: '2026-11-15', dueDay: 15, completedInstallments: 0 }
  saveDebts([installmentDebt({ paymentSchedule: payInFour }), installmentDebt({ id: 8, minimumPayment: 40, paymentSchedule: legacyMonthly })], storage)
  const raw = storage.getItem(DEBT_STORAGE_KEY)
  const [loadedPayInFour, loadedMonthly] = loadDebts(storage)
  assert.deepEqual(loadedPayInFour.paymentSchedule, payInFour)
  assert.deepEqual(loadedMonthly.paymentSchedule, legacyMonthly)
  assert.deepEqual(getDebtScheduledPayments(loadedPayInFour, 50).map(item => [item.dueDate, item.amount, item.installmentNumber]), [
    ['2026-11-30', 25, 3], ['2026-12-14', 25.01, 4]
  ])
  const { bills } = synchronizeDebtBills(storage)
  assert.equal(bills.find(bill => bill.debtId === 7).frequency, 'debt-installments')
  assert.equal(getBillOccurrencesInRange(bills.filter(bill => bill.debtId === 7), '2026-01-01', '2030-12-31').length, 2)
  assert.equal(bills.find(bill => bill.debtId === 8).frequency, 'monthly')
  assert.deepEqual(JSON.parse(storage.getItem(DEBT_STORAGE_KEY)).debts.map(debt => debt.paymentSchedule), JSON.parse(raw).debts.map(debt => debt.paymentSchedule))
})

test('changing installment frequency preserves paid installment identities and never schedules them again', () => {
  const storage = createStorage()
  saveAccountData([{ id: 1, name: 'Checking', openingBalance: 2000 }], [], storage)
  saveDebts([installmentDebt({ currentBalance: 75.01, paymentSchedule: {
    kind: 'pay-in-4', frequency: 'biweekly', startDate: '2026-11-16',
    completedInstallments: 1, totalInstallments: 4, remainingTotal: 75.01
  } })], storage)
  synchronizeDebtBills(storage)
  createDebtPayment(7, 'payment:2', { total: 25, principal: 25, accountId: 1, date: '2026-11-16' }, storage)
  createDebtPayment(7, 'payment:3', { total: 25, principal: 25, accountId: 1, date: '2026-11-30' }, storage)
  const debt = loadDebts(storage)[0]
  const history = structuredClone(debt.paymentHistory)
  debt.paymentSchedule.frequency = 'monthly'
  saveDebts([debt], storage)
  const { debts, bills } = synchronizeDebtBills(storage)
  const transactions = loadSavedAccountData(storage).transactions
  const upcoming = getBillOccurrencesInRange(bills, '2026-01-01', '2027-12-31', transactions).filter(item => !item.paid && !item.skipped)
  assert.equal(upcoming.length, 1)
  assert.equal(upcoming[0].dueDate, '2027-01-16')
  assert.equal(upcoming[0].amount, 25.01)
  assert.deepEqual(getDebtInstallmentProgress(debts[0]), { completed: 3, total: 4, remaining: 1 })
  assert.equal(getNextDebtPaymentDue(debts[0]), '2027-01-16')
  assert.deepEqual(debts[0].paymentHistory, history)
})

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

test('credit limits calculate available credit independently of historical payoff balances', () => {
  const debt = { type: 'Credit Card', startingBalance: 2000, currentBalance: 1500.25, creditLimit: 5000 }
  const before = structuredClone(debt)
  assert.equal(getAvailableCredit(debt), 3499.75)
  assert.equal(getDebtProgress(debt), 24.9875)
  assert.equal(calculateOverallDebtSummary([debt]).totalStarting, 2000)
  assert.equal(getAvailableCredit({ ...debt, currentBalance: 5100 }), -100)
  assert.equal(getAvailableCredit({ ...debt, creditLimit: 0 }), -1500.25)
  assert.equal(getAvailableCredit({ ...debt, creditLimit: null }), null)
  assert.equal(getAvailableCredit({ ...debt, creditLimit: undefined }), null)
  assert.equal(getAvailableCredit({ ...debt, type: 'Auto Loan' }), null)
  assert.deepEqual(debt, before)
})

test('legacy debts load and save without migration, name parsing, or inferred credit limits and assignees', () => {
  const storage = createStorage()
  seed(storage)
  const legacy = { ...loadDebts(storage)[0], type: 'Credit Card', name: 'E Visa 0042' }
  saveDebts([legacy], storage)
  const original = storage.getItem(DEBT_STORAGE_KEY)
  const loaded = loadDebts(storage)
  assert.deepEqual(loaded, [legacy])
  assert.equal(getDebtAssignee(loaded[0]), undefined)
  assert.equal(getAvailableCredit(loaded[0]), null)
  saveDebts(loaded, storage)
  assert.equal(storage.getItem(DEBT_STORAGE_KEY), original)
})

test('optional debt metadata preserves leading zeros and validates assignees and credit limits', () => {
  const storage = createStorage()
  seed(storage)
  const base = loadDebts(storage)[0]
  for (const assignedTo of ['', 'E', 'R', 'Joint', 'Other']) {
    const debt = validateDebt({ ...base, creditLimit: 10000.25, accountLast4: '0042', assignedTo, customAssignee: 'Household' })
    saveDebts([debt], storage)
    assert.deepEqual(loadDebts(storage)[0], debt)
    assert.equal(getDebtAssignee(debt), assignedTo === 'Other' ? 'Household' : assignedTo)
  }
  for (const metadata of [
    { accountLast4: '123' }, { accountLast4: '12345' }, { accountLast4: '12a4' },
    { accountLast4: 1234 }, { accountLast4: '1234\n' }, { creditLimit: -1 }, { creditLimit: NaN },
    { assignedTo: 123 }, { assignedTo: ' ' }, { customAssignee: 123 }
  ]) {
    assert.throws(() => validateDebt({ ...base, ...metadata }))
    assert.throws(() => saveDebts([{ ...base, ...metadata }], storage))
  }
})

test('assignees start with editable defaults and adding trims names and rejects duplicates without writing', () => {
  const storage = createStorage()
  assert.deepEqual(loadDebtData(storage), { debts: [], assignees: ['E', 'R', 'Joint'] })
  assert.equal(storage.getItem(DEBT_STORAGE_KEY), null)
  addDebtAssignee('  Household  ', storage)
  assert.deepEqual(loadDebtData(storage).assignees, ['E', 'R', 'Joint', 'Household'])
  const before = storage.getItem(DEBT_STORAGE_KEY)
  for (const name of ['household', ' HOUSEHOLD ', ' e ', ' ', '']) {
    assert.throws(() => addDebtAssignee(name, storage), /already exists|Enter an assignee name/)
    assert.equal(storage.getItem(DEBT_STORAGE_KEY), before)
  }
})

test('renaming updates active and archived assignments while preserving every financial field and other storage', () => {
  const storage = createStorage()
  seed(storage)
  const base = loadDebts(storage)[0]
  const debts = [
    { ...base, assignedTo: 'E', paymentHistory: [{ id: 'payment', principal: 200, total: 225 }] },
    { ...base, id: 8, name: 'Archived card', assignedTo: 'E', archived: true },
    { ...base, id: 9, assignedTo: 'R' },
    { ...base, id: 10 }
  ]
  saveDebts(debts, storage)
  const accountsBefore = storage.getItem('money-honey-account-data')
  const original = storage.getItem(DEBT_STORAGE_KEY)
  assert.throws(() => renameDebtAssignee('E', ' r ', storage), /already exists/)
  assert.equal(storage.getItem(DEBT_STORAGE_KEY), original)
  renameDebtAssignee('E', ' Primary ', storage)
  assert.deepEqual(loadDebtData(storage).assignees, ['Primary', 'R', 'Joint'])
  assert.deepEqual(loadDebts(storage), debts.map(debt =>
    debt.assignedTo === 'E' ? { ...debt, assignedTo: 'Primary' } : debt
  ))
  assert.equal(storage.getItem('money-honey-account-data'), accountsBefore)
  saveDebts(loadDebts(storage), storage)
  assert.deepEqual(loadDebtData(storage).assignees, ['Primary', 'R', 'Joint'])
})

test('legacy custom assignees become managed options without rewriting records, and deletion only clears assignments', () => {
  const storage = createStorage()
  seed(storage)
  const base = loadDebts(storage)[0]
  const debts = [
    { ...base, assignedTo: 'Other', customAssignee: 'Household', paymentHistory: [{ id: 'old', principal: 5 }] },
    { ...base, id: 8, archived: true, assignedTo: 'Other', customAssignee: 'household' },
    { ...base, id: 9, assignedTo: 'R' }
  ]
  const legacy = JSON.stringify({ version: 1, debts })
  storage.setItem(DEBT_STORAGE_KEY, legacy)
  assert.deepEqual(loadDebtData(storage).assignees, ['E', 'R', 'Joint', 'Household'])
  assert.equal(storage.getItem(DEBT_STORAGE_KEY), legacy)
  renameDebtAssignee('Household', 'Family', storage)
  assert.deepEqual(loadDebts(storage), debts.map(debt => {
    if (debt.assignedTo !== 'Other') return debt
    const updated = { ...debt, assignedTo: 'Family' }
    delete updated.customAssignee
    return updated
  }))
  const beforeDelete = loadDebts(storage)
  deleteDebtAssignee('Family', storage)
  assert.deepEqual(loadDebts(storage), beforeDelete.map(debt =>
    debt.assignedTo === 'Family' ? { ...debt, assignedTo: '' } : debt
  ))
  for (const name of ['E', 'R', 'Joint']) deleteDebtAssignee(name, storage)
  assert.deepEqual(loadDebtData(storage).assignees, [])
  assert.ok(loadDebts(storage).every(debt => !getDebtAssignee(debt)))
  saveDebts(loadDebts(storage), storage)
  assert.deepEqual(loadDebtData(storage).assignees, [])
})

test('assignee changes fail atomically when storage is unavailable', () => {
  const storage = createStorage()
  seed(storage)
  saveDebts([{ ...loadDebts(storage)[0], assignedTo: 'E' }], storage)
  const before = storage.getItem(DEBT_STORAGE_KEY)
  const failing = { ...storage, setItem: () => { throw new Error('Storage full') } }
  for (const update of [
    () => addDebtAssignee('Household', failing),
    () => renameDebtAssignee('E', 'Primary', failing),
    () => deleteDebtAssignee('E', failing)
  ]) {
    assert.throws(update, /Storage full/)
    assert.equal(storage.getItem(DEBT_STORAGE_KEY), before)
  }
})

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

test('skipped installments advance only their own occurrence and do not count as overdue', () => {
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

  let status = getDebtScheduleStatus(debt, [bill], [], '2026-11-10')
  assert.equal(status.nextDueDate, '2026-09-08')
  assert.equal(status.oldestOverdueDate, '2026-09-08')
  assert.equal(status.overdueCount, 2)
  assert.equal(status.overdueAmount, 48)
  assert.equal(status.isPastDue, true)

  bill.paymentHistory.push({
    dueDate: '2026-10-08',
    skipped: false,
    changedAt: '2026-11-11T12:00:00Z'
  })
  status = getDebtScheduleStatus(debt, [bill], [], '2026-11-10')
  assert.equal(status.nextDueDate, '2026-09-08')
  assert.equal(status.overdueCount, 3)
  assert.equal(status.overdueAmount, 72)
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
    date: '2026-04-14',
    cleared: false,
    linkedOccurrenceType: 'bill',
    linkedOccurrenceId: 'bill:9:2026-04-15',
    linkedBillOccurrenceId: 'bill:9:2026-04-15'
  })

  saveAccountData(accountData.accounts, accountData.transactions, storage)
  const details = {
    date: '2026-04-16',
    principal: 300,
    interest: 100,
    fees: 0,
    billOccurrenceId: 'bill:9:2026-04-16',
    scheduledDueDate: '2026-04-16'
  }
  recordDebtPaymentFromTransaction(7, 12, details, storage)
  recordDebtPaymentFromTransaction(7, 12, details, storage)

  const savedAccounts = loadSavedAccountData(storage)
  const debt = loadDebts(storage)[0]
  assert.equal(savedAccounts.transactions.length, 1)
  assert.equal(savedAccounts.transactions[0].linkedBillOccurrenceId, 'bill:9:2026-04-15')
  assert.equal(savedAccounts.transactions[0].linkedDebtId, 7)
  assert.equal(debt.paymentHistory[0].date, '2026-04-14')
  assert.equal(debt.paymentHistory[0].scheduledDueDate, '2026-04-15')
  assert.equal(debt.paymentHistory[0].billOccurrenceId, 'bill:9:2026-04-15')
  assert.equal(debt.currentBalance, 7700)
  assert.equal(debt.paymentHistory.length, 1)
})

test('multiple principal reductions and reversals preserve saved balance adjustments', () => {
  const storage = createStorage()
  seed(storage)
  saveDebts(loadDebts(storage).map(debt => ({
    ...debt,
    currentBalance: 1000,
    interestRate: 6.5,
    paymentCalculationMethod: 'manual-principal'
  })), storage)
  const accountData = loadSavedAccountData(storage)
  accountData.transactions.push(
    {
      id: 12,
      accountId: 1,
      name: 'Auto loan payment',
      amount: -300,
      date: '2026-04-14',
      cleared: true,
      linkedBillOccurrenceId: 'bill:11:2026-04-15'
    },
    {
      id: 13,
      accountId: 1,
      name: 'Auto loan payment',
      amount: -200,
      date: '2026-05-14',
      cleared: false,
      linkedBillOccurrenceId: 'bill:11:2026-05-15'
    }
  )
  saveAccountData(accountData.accounts, accountData.transactions, storage)

  const first = recordDebtPaymentFromTransaction(7, 12, {
    principal: 200,
    interest: 100,
    fees: 0,
    billOccurrenceId: 'bill:11:2026-04-15',
    scheduledDueDate: '2026-04-15'
  }, storage)
  const second = recordDebtPaymentFromTransaction(7, 13, {
    principal: 125,
    interest: 75,
    fees: 0,
    billOccurrenceId: 'bill:11:2026-05-15',
    scheduledDueDate: '2026-05-15'
  }, storage)

  let debt = loadDebts(storage)[0]
  assert.equal(debt.currentBalance, 675)
  assert.deepEqual(debt.paymentHistory.map(payment => [
    payment.date,
    payment.scheduledDueDate,
    payment.billOccurrenceId,
    payment.principal
  ]), [
    ['2026-04-14', '2026-04-15', 'bill:11:2026-04-15', 200],
    ['2026-05-14', '2026-05-15', 'bill:11:2026-05-15', 125]
  ])
  assert.equal(getDebtPrincipalPaid(debt), 325)

  debt.currentBalance = 700
  saveDebts([debt], storage)
  reverseDebtPayment(first.id, storage)
  debt = loadDebts(storage)[0]
  assert.equal(debt.currentBalance, 900)
  assert.equal(getDebtPrincipalPaid(debt), 125)
  reverseDebtPayment(second.id, storage)
  debt = loadDebts(storage)[0]
  assert.equal(debt.currentBalance, 1025)
  assert.equal(getDebtPrincipalPaid(debt), 0)
  assert.equal(loadSavedAccountData(storage).transactions.length, 0)
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
  assert.equal(debt.paymentHistory[0].scheduledDueDate, '2026-04-15')
  assert.equal(debt.paymentHistory[0].billOccurrenceId, 'bill:9:2026-04-15')
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

test('calculateOverallDebtSummary computes total remaining, paid off, and progress percent correctly', () => {
  assert.deepEqual(calculateOverallDebtSummary([]), {
    totalStarting: 0,
    totalRemaining: 0,
    totalPaidOff: 0,
    progressPercent: 0
  })

  const debts = [
    { id: 1, startingBalance: 1000, currentBalance: 400 },
    { id: 2, startingBalance: 2000, currentBalance: 1100 }
  ]
  assert.deepEqual(calculateOverallDebtSummary(debts), {
    totalStarting: 3000,
    totalRemaining: 1500,
    totalPaidOff: 1500,
    progressPercent: 50
  })

  // Overpaid edge case
  const overpaid = [
    { id: 1, startingBalance: 100, currentBalance: 0 },
    { id: 2, startingBalance: 50, currentBalance: 0 }
  ]
  assert.deepEqual(calculateOverallDebtSummary(overpaid), {
    totalStarting: 150,
    totalRemaining: 0,
    totalPaidOff: 150,
    progressPercent: 100
  })

  // Balance increased
  const increased = [
    { id: 1, startingBalance: 100, currentBalance: 120 }
  ]
  assert.deepEqual(calculateOverallDebtSummary(increased), {
    totalStarting: 100,
    totalRemaining: 120,
    totalPaidOff: 0,
    progressPercent: 0
  })
})

test('deleteDebt removes only that debt, keeps transactions unlinked, and keeps bills holding payment history', () => {
  const storage = createStorage()
  const payment = { id: '1:1', transactionId: 50, total: 20, principal: 20, date: '2026-11-01' }
  saveDebts([
    installmentDebt({ id: 1, name: 'Duplicate', paymentSchedule: undefined, minimumPayment: 20, billId: 10, paymentHistory: [payment] }),
    installmentDebt({ id: 2, name: 'Keep', paymentSchedule: undefined, minimumPayment: 30, billId: 12 })
  ], storage)
  saveAccountData([{ id: 1, name: 'Checking', openingBalance: 500 }], [
    { id: 50, accountId: 1, amount: -20, date: '2026-11-01', transactionType: 'debt-payment', linkedDebtId: 1, linkedDebtPaymentId: '1:1' },
    { id: 51, accountId: 1, amount: -30, date: '2026-11-01', transactionType: 'debt-payment', linkedDebtId: 2 }
  ], storage)
  saveBillData({ bills: [
    { id: 10, name: 'Duplicate', debtId: 1, debtManaged: true, paymentHistory: [{ transactionId: 50 }] },
    { id: 11, name: 'Duplicate extra', debtId: 1, debtManaged: true, paymentHistory: [] },
    { id: 12, name: 'Keep', debtId: 2, debtManaged: true, paymentHistory: [] },
    { id: 13, name: 'My own bill', debtId: 1, debtManaged: false, paymentHistory: [] }
  ] }, storage)

  assert.deepEqual(deleteDebt(1, storage).map(debt => debt.name), ['Keep'])
  const [kept, other] = loadSavedAccountData(storage).transactions
  assert.equal(kept.amount, -20)
  assert.equal(kept.transactionType, 'debt-payment')
  assert.equal(kept.linkedDebtId, undefined)
  assert.equal(kept.linkedDebtPaymentId, undefined)
  assert.equal(other.linkedDebtId, 2)
  const bills = loadBillData([], storage).bills
  assert.deepEqual(bills.map(bill => [bill.id, bill.debtId, bill.archived ?? false]), [[10, null, true], [12, 2, false], [13, null, false]])
  assert.deepEqual(bills[0].paymentHistory, [{ transactionId: 50 }])
  assert.throws(() => deleteDebt(1, storage), /no longer exists/)
})
