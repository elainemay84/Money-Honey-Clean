import assert from 'node:assert/strict'
import test from 'node:test'
import { calculatePaycheckForecast } from './paycheckForecast.js'

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

  assert.equal(forecast.availableFunds, 1025)
  assert.equal(forecast.upcomingIncome, 250)
  assert.equal(forecast.scheduledBills, 50)
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
