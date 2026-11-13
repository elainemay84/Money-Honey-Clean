import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateDailySpending } from './dailySpending.js'

const forecast = (endDate, projectedRemainingFunds) => ({
  startDate: '2026-11-11',
  endDate,
  projectedRemainingFunds,
  hasIncomeSchedule: true
})

test('calculates a daily limit from forecast funds and remaining budget', () => {
  const result = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Groceries'],
    budgets: { Groceries: 100 },
    forecast: forecast('2026-11-13', 90),
    transactions: [
      { name: 'Groceries', category: 'Groceries', amount: -20, date: '2026-11-11' },
      { name: 'Future groceries', category: 'Groceries', amount: -10, date: '2026-11-12' },
      { name: 'Older groceries', category: 'Groceries', amount: -20, date: '2026-10-01' }
    ]
  })

  assert.equal(result.suggestedDailyLimit, 3)
  assert.equal(result.todaySpending, 20)
  assert.equal(result.remainingToday, -17)
})

test('uses forecast periods produced by weekly and biweekly income schedules', () => {
  const weeklyResult = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Groceries'],
    forecast: forecast('2026-11-12', 100),
    transactions: []
  })
  const biweeklyResult = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Groceries'],
    forecast: forecast('2026-11-25', 300),
    transactions: []
  })

  assert.equal(weeklyResult.forecastDays, 30)
  assert.equal(weeklyResult.suggestedDailyLimit, 100 / 30)
  assert.equal(biweeklyResult.forecastDays, 30)
  assert.equal(biweeklyResult.suggestedDailyLimit, 300 / 30)
})

test('calculates historical average from transaction dates and requires sufficient history', () => {
  const result = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Eating Out'],
    forecast: forecast('2026-11-12', 100),
    transactions: [
      { name: 'Cafe', category: 'Eating Out', amount: -30, date: '2026-10-20' },
      { name: 'Lunch', category: 'Eating Out', amount: -20, date: '2026-11-01' },
      { name: 'Dinner', category: 'Eating Out', amount: -10, date: '2026-11-11' }
    ]
  })

  assert.equal(result.averageDailySpending, 2)
  assert.equal(result.todaySpending, 10)
})

test('excludes future today spending, transfers, and duplicate debt payments', () => {
  const result = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Shopping', 'Debt Payments'],
    forecast: forecast('2026-11-12', 100),
    transactions: [
      { name: 'Shopping', category: 'Shopping', amount: -40, date: '2026-11-11' },
      { name: 'Tomorrow shopping', category: 'Shopping', amount: -25, date: '2026-11-12' },
      { name: 'Transfer to savings', category: 'Shopping', amount: -50, date: '2026-11-11', type: 'transfer' },
      { name: 'Debt principal', category: 'Debt Payments', amount: -100, date: '2026-11-11' },
      { name: 'Payment to credit card', category: 'Shopping', amount: -100, date: '2026-11-11', linkedOccurrenceId: 'debt:1' },
      { name: 'Payment to credit card copy', category: 'Shopping', amount: -100, date: '2026-11-11', linkedOccurrenceId: 'debt:1' }
    ]
  })

  assert.equal(result.todaySpending, 40)
})

test('shows overages and does not reuse manual budgets for Smart Budget mode', () => {
  const overage = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Groceries'],
    budgets: { Groceries: 20 },
    forecast: forecast('2026-11-12', 100),
    transactions: [
      { name: 'Groceries', category: 'Groceries', amount: -50, date: '2026-11-11' }
    ]
  })
  const smartWithoutApprovedBudget = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Groceries'],
    budgets: {},
    forecast: forecast('2026-11-12', 100),
    transactions: []
  })

  assert.equal(overage.remainingToday, -145 / 3)
  assert.equal(smartWithoutApprovedBudget.remainingBudget, null)
  assert.equal(smartWithoutApprovedBudget.suggestedDailyLimit, 100 / 30)
})

test('cash-flow safety caps the allowance at zero when the forecast temporarily goes negative', () => {
  const result = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Groceries'],
    forecast: {
      ...forecast('2026-11-12', 200),
      cashFlowSafety: {
        lowestProjectedBalance: -50,
        safetyCapacity: 0
      }
    },
    transactions: [
      { name: 'Groceries', category: 'Groceries', amount: -20, date: '2026-11-11' }
    ]
  })

  assert.equal(result.suggestedDailyLimit, 0)
  assert.equal(result.remainingToday, -20)
})

test('explanation uses the calculated allowance and forecast values', () => {
  const result = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Groceries'],
    budgets: { Groceries: 120 },
    forecast: {
      ...forecast('2026-12-10', 300),
      availableFunds: 250,
      projectedRemainingFunds: 550,
      upcomingIncome: 500,
      scheduledBills: 200,
      cashFlowSafety: {
        lowestProjectedBalance: 180,
        lowestProjectedBalanceDate: '2026-11-18',
        safetyCapacity: 260
      }
    },
    transactions: [
      { name: 'Today groceries', category: 'Groceries', amount: -20, date: '2026-11-11' },
      { name: 'Future groceries', category: 'Groceries', amount: -15, date: '2026-11-15' }
    ]
  })

  assert.equal(result.explanation.currentAvailableFunds, 250)
  assert.equal(result.explanation.totalProjectedFunds, 550)
  assert.equal(result.explanation.expectedIncome, 500)
  assert.equal(result.explanation.upcomingBills, 200)
  assert.equal(result.explanation.futureDatedTransactions, -15)
  assert.equal(result.explanation.lowestProjectedBalanceDate, '2026-11-18')
  assert.equal(result.explanation.cashFlowSafetyCapacity, 260)
  assert.equal(result.explanation.finalDiscretionaryPool, 105)
  assert.equal(result.explanation.protectedFunds, 465)
  assert.equal(result.explanation.limitingAmount, 105)
  assert.equal(result.explanation.finalSuggestedDailyAllowance, result.suggestedDailyLimit)
  assert.equal(
    result.explanation.finalDiscretionaryPool / 30,
    result.explanation.finalSuggestedDailyAllowance
  )
  assert.match(result.explanation.limitingConstraint, /budgets/)
})

test('returns insufficient information without a forecast endpoint or history', () => {
  const result = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Pets'],
    forecast: { projectedRemainingFunds: 100, hasIncomeSchedule: true },
    transactions: [
      { name: 'Pet food', category: 'Pets', amount: -25, date: '2026-11-11' }
    ]
  })

  assert.equal(result.suggestedDailyLimit, null)
  assert.equal(result.averageDailySpending, null)
  assert.equal(result.remainingToday, null)
})

test('daily spending uses the shared rules: refunds reduce it, uncategorized counts, debt-linked payments do not', () => {
  const result = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Shopping', 'Groceries'],
    forecast: forecast('2026-11-12', 100),
    transactions: [
      { name: 'Shopping', category: 'Shopping', amount: -50, date: '2026-11-11' },
      { name: 'Return', category: 'Shopping', amount: 20, date: '2026-11-11' },
      { name: 'No category', amount: -15, date: '2026-11-11' },
      { name: 'Card bill', category: 'Shopping', amount: -300, date: '2026-11-11', linkedDebtId: 1, transactionType: 'debt-payment' },
      { name: 'Paycheck', category: 'Paycheck', amount: 900, date: '2026-11-11' }
    ]
  })

  assert.equal(result.todaySpending, 45)
})

test('a refund larger than the day\'s spending never makes spending negative', () => {
  const result = calculateDailySpending({
    today: '2026-11-11',
    categories: ['Shopping'],
    forecast: forecast('2026-11-12', 100),
    transactions: [
      { name: 'Shopping', category: 'Shopping', amount: -10, date: '2026-11-11' },
      { name: 'Return', category: 'Shopping', amount: 40, date: '2026-11-11' }
    ]
  })
  assert.equal(result.todaySpending, 0)
})
