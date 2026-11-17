import assert from 'node:assert/strict'
import test from 'node:test'
import { calculatePaycheckForecast } from './paycheckForecast.js'
import { getPaydayBillSummary } from './billData.js'
import { getDebtForecastBills } from './debtData.js'
import { createPaymentPlan } from './debtSchedule.js'

const account = {
  id: 1,
  name: 'Checking',
  type: 'Checking',
  openingBalance: 1000,
  openingDate: '2026-04-01',
  archived: false
}

function income(id, amount, dueDate, frequency) {
  return {
    id,
    name: `Income ${id}`,
    amount,
    dueDate,
    frequency,
    accountId: 1,
    paymentHistory: []
  }
}

function bill(id, amount, dueDate, paymentHistory = []) {
  return {
    id,
    name: `Bill ${id}`,
    amount,
    dueDate,
    frequency: 'one-time',
    accountId: 1,
    paymentHistory
  }
}

test('combines weekly and biweekly income scheduled for the same payday', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [account],
    transactions: [],
    bills: [],
    incomes: [
      income(1, 100, '2026-04-10', 'weekly'),
      income(2, 250, '2026-04-10', 'biweekly')
    ],
    today: '2026-04-08'
  })

  assert.equal(forecast.nextPayday, '2026-04-10')
  assert.equal(forecast.upcomingIncome, 350)
  assert.equal(forecast.nextPaydayIncome, 350)
  assert.equal(forecast.projectedRemainingFunds, 1350)
})

test('next-payday income excludes later scheduled paydays', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [account],
    transactions: [],
    bills: [],
    incomes: [
      income(1, 1000, '2026-11-12', 'weekly'),
      income(2, 2000, '2026-11-19', 'biweekly')
    ],
    today: '2026-11-11'
  })

  assert.equal(forecast.nextPayday, '2026-11-12')
  assert.equal(forecast.nextPaydayIncome, 1000)
})

test('does not double-count linked income or paid bills and respects cleared transactions', () => {
  const transactions = [
    {
      id: 10,
      accountId: 1,
      name: 'Income 1',
      amount: 100,
      date: '2026-04-10',
      cleared: true,
      linkedIncomeOccurrenceId: '1:2026-04-10'
    },
    {
      id: 11,
      accountId: 1,
      name: 'Bill 3',
      amount: -75,
      date: '2026-04-10',
      cleared: true,
      linkedOccurrenceType: 'bill',
      linkedOccurrenceId: 'bill:3:2026-04-10'
    }
  ]
  const forecast = calculatePaycheckForecast({
    accounts: [account],
    transactions,
    bills: [
      bill(3, 75, '2026-04-10', [{ dueDate: '2026-04-10', paid: true }]),
      bill(4, 50, '2026-04-09'),
      bill(5, 40, '2026-04-10', [{ dueDate: '2026-04-10', skipped: true }])
    ],
    incomes: [
      income(1, 100, '2026-04-10', 'weekly'),
      income(2, 250, '2026-04-10', 'biweekly')
    ],
    today: '2026-04-08'
  })

  assert.equal(forecast.availableFunds, 1000)
  assert.equal(forecast.upcomingIncome, 350)
  assert.equal(forecast.scheduledBills, 125)
  assert.equal(forecast.projectedRemainingFunds, 1225)
})

test('uses one explicit date range when pay periods overlap at the endpoint', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [account],
    transactions: [],
    bills: [
      bill(1, 50, '2026-04-10'),
      bill(2, 75, '2026-04-11')
    ],
    incomes: [
      income(1, 100, '2026-04-10', 'weekly'),
      income(2, 200, '2026-04-10', 'biweekly')
    ],
    today: '2026-04-08',
    forecastEndDate: '2026-04-10'
  })

  assert.deepEqual(
    { startDate: forecast.startDate, endDate: forecast.endDate },
    { startDate: '2026-04-08', endDate: '2026-04-10' }
  )
  assert.equal(forecast.upcomingIncome, 300)
  assert.equal(forecast.scheduledBills, 50)
})

test('cash-flow safety prevents a bill before payday from using later income', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [{ ...account, openingBalance: 100 }],
    transactions: [],
    bills: [bill(1, 150, '2026-04-09')],
    incomes: [income(1, 200, '2026-04-10', 'weekly')],
    today: '2026-04-08',
    forecastEndDate: '2026-04-12'
  })

  assert.equal(forecast.cashFlowSafety.lowestProjectedBalance, -50)
  assert.equal(forecast.cashFlowSafety.lowestProjectedAccountName, 'Checking')
  assert.equal(forecast.cashFlowSafety.safetyCapacity, 0)
})

test('cash-flow safety allows income scheduled before a later bill', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [{ ...account, openingBalance: 100 }],
    transactions: [],
    bills: [bill(1, 150, '2026-04-10')],
    incomes: [income(1, 200, '2026-04-09', 'biweekly')],
    today: '2026-04-08',
    forecastEndDate: '2026-04-12'
  })

  assert.equal(forecast.cashFlowSafety.lowestProjectedBalance, 100)
  assert.equal(forecast.cashFlowSafety.safetyCapacity, 100)
})

test('paid but uncleared future bills are represented once in safety projection', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [{ ...account, openingBalance: 100 }],
    transactions: [{
      id: 20,
      accountId: 1,
      name: 'Bill 1',
      amount: -100,
      date: '2026-04-10',
      cleared: false,
      linkedOccurrenceType: 'bill',
      linkedOccurrenceId: 'bill:1:2026-04-10'
    }],
    bills: [bill(1, 100, '2026-04-10')],
    incomes: [income(1, 100, '2026-04-12', 'weekly')],
    today: '2026-04-08',
    forecastEndDate: '2026-04-12'
  })

  assert.equal(forecast.cashFlowSafety.lowestProjectedBalance, 0)
  assert.equal(forecast.cashFlowSafety.safetyCapacity, 0)
})

test('savings cannot cover a checking account shortfall automatically', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [
      { ...account, id: 1, openingBalance: 100, type: 'Checking' },
      { ...account, id: 2, openingBalance: 500, type: 'Savings' }
    ],
    transactions: [],
    bills: [bill(1, 150, '2026-04-09')],
    incomes: [],
    today: '2026-04-08',
    forecastEndDate: '2026-04-12'
  })

  assert.equal(forecast.cashFlowSafety.safetyCapacity, 0)
})

test('Home reconciles negative cash, many uncleared expenses, bills, linked payments and payday income', () => {
  const accounts = [
    { ...account, openingDate: '2026-11-01' },
    { ...account, id: 2, type: 'Savings', openingBalance: 500 },
    { ...account, id: 3, openingBalance: -200 },
    { ...account, id: 4, type: 'Credit Card', openingBalance: 12000, creditLimit: 20000 },
    { ...account, id: 5, archived: true, openingBalance: 9000 },
    { ...account, id: 6, type: 'Investment', openingBalance: 15000 }
  ]
  const transactions = [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: index + 1, accountId: 1, amount: -100, date: '2026-11-16', cleared: false
    })),
    { id: 21, accountId: 1, name: 'Bill 1', amount: -80, date: '2026-11-17', cleared: false,
      linkedBillOccurrenceId: 'bill:1:2026-11-17' },
    { id: 22, accountId: 1, name: 'Bill 2', amount: -40, date: '2026-11-18', cleared: false,
      linkedBillOccurrenceId: 'bill:2:2026-11-18' },
    { id: 23, accountId: 1, amount: 300, date: '2026-11-19', cleared: false,
      linkedIncomeOccurrenceId: 'income:1:2026-11-19' },
    { id: 24, accountId: 1, amount: 10000, date: '2026-11-20', cleared: true },
    { id: 25, accountId: 4, amount: -600, date: '2026-11-17', cleared: false },
    { id: 26, accountId: 1, amount: -15, date: '2026-11-19', cleared: false }
  ]
  const bills = [
    bill(1, 80, '2026-11-17'),
    bill(2, 40, '2026-11-18'),
    bill(3, 60, '2026-11-19'),
    bill(4, 25, '2026-11-15'),
    bill(5, 800, '2026-11-20'),
    { ...bill(6, 90, '2026-11-18'), accountId: 4 },
    bill(7, 100, '2026-11-18', [{ dueDate: '2026-11-18', skipped: true }])
  ]
  const forecast = calculatePaycheckForecast({
    accounts, transactions, bills,
    incomes: [
      income(1, 300, '2026-11-19', 'weekly'),
      income(2, 200, '2026-11-19', 'biweekly'),
      { ...income(3, 900, '2026-11-18', 'weekly'), accountId: 4 }
    ],
    today: '2026-11-17',
    paySchedule: { frequency: 'biweekly', nextPayday: '2026-11-19' }
  })
  assert.equal(forecast.availableFunds, -780)
  assert.equal(forecast.upcomingIncome, 500)
  assert.equal(forecast.scheduledBills, 140) // $55 registered + $85 unrepresented.
  assert.equal(forecast.projectedRemainingFunds, -420)
  const summary = getPaydayBillSummary(bills, {
    startDate: forecast.startDate, endDate: forecast.endDate
  }, transactions)
  assert.equal(summary.totalDue, 295) // Includes the $90 obligation on the credit account.
  assert.equal(summary.cleared, 0)
  assert.equal(summary.remaining, 295)
  assert.equal(summary.pending, 120)
  assert.equal(summary.unpaid, 175)
  assert.equal(summary.totalCount, 5)
  assert.equal(summary.clearedCount, 0)
  assert.equal(summary.totalDue, summary.cleared + summary.remaining)
  assert.equal(summary.remaining, summary.pending + summary.unpaid)
})

test('clearing never changes forecast cash; transaction date and payment links change only their own components', () => {
  const options = {
    accounts: [account],
    bills: [bill(1, 80, '2026-04-10')],
    incomes: [income(1, 200, '2026-04-10', 'weekly')],
    today: '2026-04-08'
  }
  const payment = {
    id: 1, accountId: 1, amount: -80, date: '2026-04-08', cleared: false,
    linkedBillOccurrenceId: 'bill:1:2026-04-10'
  }
  const before = calculatePaycheckForecast({ ...options, transactions: [] })
  const paid = calculatePaycheckForecast({ ...options, transactions: [payment] })
  const cleared = calculatePaycheckForecast({ ...options, transactions: [{ ...payment, cleared: true }] })
  const moved = calculatePaycheckForecast({
    ...options, transactions: [{ ...payment, date: '2026-04-09' }]
  })
  assert.equal(before.scheduledBills, 80)
  assert.equal(paid.scheduledBills, 0)
  assert.equal(paid.availableFunds, 920)
  assert.equal(cleared.projectedRemainingFunds, paid.projectedRemainingFunds)
  assert.equal(moved.availableFunds, 1000)
  assert.equal(moved.scheduledBills, 80)
  assert.equal(moved.projectedRemainingFunds, paid.projectedRemainingFunds)
  const received = calculatePaycheckForecast({
    ...options,
    transactions: [payment, {
      id: 2, accountId: 1, amount: 200, date: '2026-04-08', cleared: false,
      linkedIncomeOccurrenceId: '1:2026-04-10'
    }]
  })
  assert.equal(received.availableFunds, 1120)
  assert.equal(received.upcomingIncome, 0)
  assert.equal(received.projectedRemainingFunds, paid.projectedRemainingFunds)
})

test('uses actual linked payment amounts despite renamed payees and reserves unpaid differences', () => {
  const bills = [bill(1, 80, '2026-04-09')]
  const transactions = [{
    id: 1, accountId: 1, name: 'Renamed payee', amount: -30,
    date: '2026-04-08', cleared: true, linkedBillOccurrenceId: 'bill:1:2026-04-09'
  }]
  const forecast = calculatePaycheckForecast({
    accounts: [account], bills, transactions, incomes: [],
    today: '2026-04-08', forecastEndDate: '2026-04-10'
  })
  assert.equal(forecast.availableFunds, 970)
  assert.equal(forecast.scheduledBills, 50)
  assert.equal(forecast.projectedRemainingFunds, 920)
  const summary = getPaydayBillSummary(bills, { startDate: '2026-04-08', endDate: '2026-04-10' }, transactions)
  assert.equal(summary.cleared, 0)
  assert.equal(summary.remaining, 80)
  assert.equal(summary.clearedCount, 0)
})

test('payday settings control an inclusive cutoff and do not invent income', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [account],
    bills: [bill(1, 25, '2026-04-10'), bill(2, 75, '2026-04-11')],
    incomes: [income(1, 200, '2026-04-11', 'weekly')],
    transactions: [
      { id: 1, accountId: 1, amount: -10, date: '2026-04-10', cleared: false },
      { id: 2, accountId: 1, amount: 9000, date: '2026-04-11', cleared: true }
    ],
    today: '2026-04-08',
    paySchedule: { frequency: 'weekly', nextPayday: '2026-04-10' }
  })
  assert.equal(forecast.nextPayday, '2026-04-10')
  assert.equal(forecast.availableFunds, 1000)
  assert.equal(forecast.upcomingIncome, 0)
  assert.equal(forecast.scheduledBills, 35)
  assert.equal(forecast.projectedRemainingFunds, 965)
})

test('debt plans forecast without visiting Debt, and a linked installment is deducted only once', () => {
  const debt = {
    id: 7, name: 'Plan', currentBalance: 100, minimumPayment: 50, accountId: 1,
    billId: 9, paymentHistory: [],
    paymentSchedule: createPaymentPlan([
      { dueDate: '2026-04-09', amount: 40 },
      { dueDate: '2026-04-10', amount: 60 },
      { dueDate: '2026-04-11', amount: 80 }
    ])
  }
  const options = {
    accounts: [account], debts: [debt], incomes: [],
    today: '2026-04-08', forecastEndDate: '2026-04-10'
  }
  const original = JSON.stringify(debt)
  const unsynced = calculatePaycheckForecast(options)
  assert.equal(unsynced.scheduledBills, 100)
  const bills = [{
    ...bill(9, 40, '2026-04-09'), name: 'Plan', debtId: 7, debtManaged: true
  }]
  const transactions = [{
    id: 1, accountId: 1, name: 'Plan', amount: -40, date: '2026-04-08', cleared: false,
    linkedDebtId: 7, linkedDebtPaymentId: '7:1', linkedBillOccurrenceId: 'bill:9:2026-04-09'
  }]
  const paid = calculatePaycheckForecast({ ...options, bills, transactions })
  assert.equal(paid.availableFunds, 960)
  assert.equal(paid.scheduledBills, 60)
  assert.equal(paid.projectedRemainingFunds, unsynced.projectedRemainingFunds)
  const projectedBills = getDebtForecastBills(bills, [debt])
  const summary = getPaydayBillSummary(projectedBills, {
    startDate: options.today, endDate: options.forecastEndDate
  }, transactions)
  assert.equal(summary.totalDue, 100)
  assert.equal(summary.pending, 40)
  assert.equal(summary.unpaid, 60)
  assert.equal(JSON.stringify(debt), original)
  assert.equal(bills[0].frequency, 'one-time')
})

test('unsynchronized debt history and pending plan rows remain reconciled without altering saved schedules', () => {
  const debt = {
    id: 7, billId: 9, name: 'Plan', currentBalance: 60, minimumPayment: 40, accountId: 1,
    paymentHistory: [{
      id: '7:1', transactionId: 1, total: 40, principal: 40,
      scheduledDueDate: '2026-04-09', installmentNumber: 1
    }],
    paymentSchedule: createPaymentPlan([
      { dueDate: '2026-04-09', amount: 40 },
      { dueDate: '2026-04-10', amount: 60, status: 'pending' },
      { dueDate: '2026-04-11', amount: 80, paid: true }
    ])
  }
  const transactions = [{
    id: 1, accountId: 1, amount: -40, name: 'Plan', date: '2026-04-08',
    cleared: false, linkedBillOccurrenceId: 'bill:9:2026-04-09'
  }]
  const options = {
    accounts: [account], debts: [debt], transactions,
    today: '2026-04-08', forecastEndDate: '2026-04-11'
  }
  const snapshot = JSON.stringify(options)
  const forecast = calculatePaycheckForecast(options)
  assert.equal(forecast.availableFunds, 960)
  assert.equal(forecast.scheduledBills, 60)
  assert.equal(forecast.projectedRemainingFunds, 900)
  assert.equal(JSON.stringify(options), snapshot)
})

test('a late linked receipt is not available before its actual date and a late bill stays reserved', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [account],
    transactions: [
      { id: 1, accountId: 1, amount: 200, date: '2026-04-11',
        linkedIncomeOccurrenceId: '1:2026-04-10' },
      { id: 2, accountId: 1, amount: -80, date: '2026-04-11',
        linkedBillOccurrenceId: 'bill:1:2026-04-09' }
    ],
    incomes: [income(1, 200, '2026-04-10', 'weekly')],
    bills: [bill(1, 80, '2026-04-09')],
    today: '2026-04-08'
  })
  assert.equal(forecast.availableFunds, 1000)
  assert.equal(forecast.upcomingIncome, 0)
  assert.equal(forecast.scheduledBills, 80)
  assert.equal(forecast.projectedRemainingFunds, 920)
})

test('unassigned unpaid obligations constrain cash-flow safety without inventing account transfers', () => {
  const forecast = calculatePaycheckForecast({
    accounts: [{ ...account, openingBalance: 100 }],
    bills: [{ ...bill(1, 150, '2026-04-09'), accountId: null }],
    today: '2026-04-08', forecastEndDate: '2026-04-10'
  })
  assert.equal(forecast.projectedRemainingFunds, -50)
  assert.equal(forecast.cashFlowSafety.safetyCapacity, 0)
})
