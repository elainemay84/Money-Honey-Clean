import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadBudgetMode,
  loadBudgets,
  loadBudgetSettings,
  calculateBudgetSnapshot,
  analyzeSmartBudgets,
  loadDismissedSmartSuggestions,
  saveDismissedSmartSuggestion,
  saveBudgetMode,
  saveBudgets,
  saveBudgetSettings
} from './budgetData.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
}

test('budgets can be created, edited, deleted, and persisted', () => {
  const storage = createStorage()
  saveBudgets({ Groceries: 500, Shopping: 200 }, storage)
  assert.deepEqual(loadBudgets(storage), { Groceries: 500, Shopping: 200 })

  saveBudgets({ Groceries: 550 }, storage)
  assert.deepEqual(loadBudgets(storage), { Groceries: 550 })

  saveBudgets({}, storage)
  assert.deepEqual(loadBudgets(storage), {})
})

test('manual and smart budgets persist separately', () => {
  const storage = createStorage()
  saveBudgets({ Groceries: 500 }, 'manual', storage)
  saveBudgets({ Groceries: 425 }, 'smart', storage)

  assert.deepEqual(loadBudgets('manual', storage), { Groceries: 500 })
  assert.deepEqual(loadBudgets('smart', storage), { Groceries: 425 })

  saveBudgets({}, 'smart', storage)
  assert.deepEqual(loadBudgets('manual', storage), { Groceries: 500 })
  assert.deepEqual(loadBudgets('smart', storage), {})
})

test('legacy budgets migrate to manual mode without appearing in smart mode', () => {
  const storage = createStorage()
  storage.setItem('money-honey-budgets', JSON.stringify({ budgets: { Housing: 1200 } }))

  assert.deepEqual(loadBudgets('manual', storage), { Housing: 1200 })
  assert.deepEqual(loadBudgets('smart', storage), {})
})

test('budget snapshot uses current-month categorized spending only', () => {
  const snapshot = calculateBudgetSnapshot({
    today: '2026-11-11',
    categories: ['Groceries'],
    mode: 'manual',
    budgets: { Groceries: 110 },
    transactions: [
      { name: 'November groceries', amount: -30, date: '2026-11-04', category: 'Groceries' },
      { name: 'Future groceries', amount: -20, date: '2026-11-30', category: 'Groceries' },
      { name: 'October groceries', amount: -90, date: '2026-10-28', category: 'Groceries' }
    ]
  })

  assert.equal(snapshot.budgetTotal, 110)
  assert.equal(snapshot.actualSpending, 50)
  assert.equal(snapshot.remaining, 60)
})

test('smart budget snapshots never use manual budget amounts', () => {
  const snapshot = calculateBudgetSnapshot({
    today: '2026-11-11',
    categories: ['Groceries'],
    mode: 'smart',
    budgets: {},
    transactions: [
      { name: 'Groceries', amount: -30, date: '2026-11-04', category: 'Groceries' }
    ]
  })

  assert.equal(snapshot.budgetTotal, 0)
  assert.equal(snapshot.hasBudgets, false)
  assert.equal(snapshot.actualSpending, 30)
})

test('budget snapshot excludes debt payments and duplicate linked transactions', () => {
  const snapshot = calculateBudgetSnapshot({
    today: '2026-11-11',
    categories: ['Groceries', 'Debt Payments'],
    mode: 'manual',
    budgets: { Groceries: 100 },
    transactions: [
      { name: 'Groceries', amount: -25, date: '2026-11-04', category: 'Groceries', linkedOccurrenceId: 'bill:1' },
      { name: 'Groceries duplicate', amount: -25, date: '2026-11-04', category: 'Groceries', linkedOccurrenceId: 'bill:1' },
      { name: 'Debt payment', amount: -50, date: '2026-11-05', category: 'Debt Payments' }
    ]
  })

  assert.equal(snapshot.actualSpending, 25)
})

test('budget snapshot caps progress while retaining an overage amount', () => {
  const snapshot = calculateBudgetSnapshot({
    today: '2026-11-11',
    categories: ['Entertainment'],
    mode: 'manual',
    budgets: { Entertainment: 30 },
    transactions: [
      { name: 'Concert', amount: -125, date: '2026-11-12', category: 'Entertainment' }
    ]
  })

  assert.equal(snapshot.actualSpending, 125)
  assert.equal(snapshot.remaining, 0)
  assert.equal(snapshot.progress, 100)
})

test('budget mode preferences persist between manual and smart modes', () => {
  const storage = createStorage()
  assert.equal(loadBudgetMode(storage), 'manual')
  saveBudgetSettings({
    mode: 'smart',
    period: 'paycheck',
    historyMonths: 12,
    suggestionsEnabled: true,
    rolloverEnabled: true
  }, storage)
  assert.equal(loadBudgetMode(storage), 'smart')
  assert.deepEqual(loadBudgetSettings(storage), {
    mode: 'smart',
    period: 'paycheck',
    historyMonths: 12,
    suggestionsEnabled: true,
    rolloverEnabled: true
  })
  saveBudgetMode('manual', storage)
  assert.equal(loadBudgetMode(storage), 'manual')
})

test('smart analysis averages across selected complete months, including zero months', () => {
  const transactions = [
    { amount: -90, date: '2026-08-15', category: 'Groceries' },
    { amount: -30, date: '2026-10-30', category: 'Groceries' }
  ]
  const threeMonths = analyzeSmartBudgets({
    transactions,
    today: '2026-11-11',
    categories: ['Groceries'],
    historyMonths: 3
  })
  const sixMonths = analyzeSmartBudgets({
    transactions,
    today: '2026-11-11',
    categories: ['Groceries'],
    historyMonths: 6
  })

  assert.deepEqual(threeMonths.months, ['2026-08', '2026-09', '2026-10'])
  assert.equal(threeMonths.categories[0].average, 40)
  assert.equal(threeMonths.categories[0].suggestedBudget, 40)
  assert.deepEqual(sixMonths.months, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  assert.equal(sixMonths.categories[0].average, 20)
  assert.equal(sixMonths.categories[0].suggestedBudget, 20)
})

test('smart analysis supports twelve months, rounding, and insufficient history', () => {
  const analysis = analyzeSmartBudgets({
    transactions: [
      { amount: -126, date: '2026-01-05', category: 'Shopping' },
      { amount: -10, date: '2026-02-05', category: 'Shopping' }
    ],
    today: '2026-11-11',
    categories: ['Shopping', 'Pets'],
    historyMonths: 12
  })

  assert.equal(analysis.months.length, 12)
  assert.equal(analysis.categories[0].average, 136 / 12)
  assert.equal(analysis.categories[0].suggestedBudget, 20)
  assert.equal(analysis.categories[1].hasEnoughHistory, false)
  assert.equal(analysis.categories[1].suggestedBudget, null)
})

test('dismissed smart suggestions persist independently from approved budgets', () => {
  const storage = createStorage()
  saveDismissedSmartSuggestion('Groceries', 'signature', storage)
  assert.deepEqual(loadDismissedSmartSuggestions(storage), { Groceries: 'signature' })
  saveBudgets({ Groceries: 100 }, 'manual', storage)
  assert.deepEqual(loadBudgets('smart', storage), {})
})
