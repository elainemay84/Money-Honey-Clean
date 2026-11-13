import assert from 'node:assert/strict'
import test from 'node:test'
import { getBudgetSpendingByCategory } from './budgetData.js'
import { EXPENSE_CATEGORIES } from './categoryData.js'
import {
  MAX_CHART_SLICES,
  contrastRatio,
  formatMonthLabel,
  getChartColors,
  getDoughnutSegments,
  getMonthBounds,
  getSpendingByCategory,
  shiftMonth
} from './reportData.js'
import { THEME_PRESETS } from './themeData.js'

const categories = EXPENSE_CATEGORIES
let nextId = 1
const expense = (category, amount, date = '2026-11-10', extra = {}) =>
  ({ id: nextId++, accountId: 1, name: `${category} purchase`, amount: -amount, date, cleared: true, category, ...extra })
const credit = (category, amount, date = '2026-11-10', extra = {}) =>
  ({ id: nextId++, accountId: 1, name: `${category} credit`, amount, date, cleared: true, category, ...extra })

const report = (transactions, month = '2026-11') => getSpendingByCategory({ transactions, month, categories })

test('multiple categories are summed, sorted from highest to lowest, and shown with percentages', () => {
  const result = report([
    expense('Groceries', 120.5),
    expense('Groceries', 79.5),
    expense('Eating Out', 50),
    expense('Gas & Fuel', 300),
    expense('Shopping', 50)
  ])

  assert.equal(result.total, 600)
  assert.deepEqual(result.items.map(item => [item.category, item.amount, item.percent]), [
    ['Gas & Fuel', 300, 50],
    ['Groceries', 200, 34],
    ['Eating Out', 50, 8],
    ['Shopping', 50, 8]
  ])
  assert.equal(result.items.reduce((sum, item) => sum + item.percent, 0), 100)
  assert.ok(result.items.every((item, index, list) => index === 0 || list[index - 1].amount >= item.amount))
})

test('percentages always add up to exactly 100 and very small shares are reported as 0', () => {
  const thirds = report([expense('Groceries', 1), expense('Eating Out', 1), expense('Shopping', 1)])
  assert.equal(thirds.items.reduce((sum, item) => sum + item.percent, 0), 100)
  const skewed = report([expense('Groceries', 5000), expense('Shopping', 3000), expense('Eating Out', 2000), expense('Other', 0.01)])
  assert.equal(skewed.items.reduce((sum, item) => sum + item.percent, 0), 100)
  assert.equal(skewed.items.find(item => item.category === 'Other').percent, 0)
})

test('money is added in cents so floating-point errors never appear', () => {
  const result = report([expense('Groceries', 0.1), expense('Groceries', 0.2), expense('Shopping', 0.07)])
  assert.equal(result.items[0].amount, 0.3)
  assert.equal(result.total, 0.37)
})

test('the totals equal the Budgets calculation for the same month', () => {
  const transactions = [
    expense('Groceries', 40),
    expense('Groceries', 12.34, '2026-11-02', { cleared: false }),
    expense('Housing & Utilities', 900, '2026-11-01', { linkedOccurrenceId: 'bill:1:2026-11-01' }),
    expense('Housing & Utilities', 900, '2026-11-01', { linkedOccurrenceId: 'bill:1:2026-11-01' }),
    expense('Debt Payments', 214),
    expense('Shopping', 75, '2026-10-30'),
    credit('Groceries', 10),
    credit('Paycheck', 1500)
  ]
  const budgets = getBudgetSpendingByCategory({ transactions, today: '2026-11-15', categories })
  const result = report(transactions)

  assert.deepEqual(Object.fromEntries(result.items.map(item => [item.category, item.amount])), {
    'Housing & Utilities': 900,
    Groceries: 52.34
  })
  for (const item of result.items) assert.equal(item.amount, Math.round(budgets[item.category] * 100) / 100)
  assert.equal(result.items.length, Object.keys(budgets).length)
})

test('empty months and months with no expenses give an empty report', () => {
  assert.deepEqual(report([]).items, [])
  assert.equal(report([]).total, 0)
  const incomeOnly = [credit('Paycheck', 1500), credit('Other Income', 20)]
  assert.deepEqual(report(incomeOnly).items, [])
  assert.deepEqual(report([expense('Groceries', 50, '2026-10-31')]).items, [])
  assert.deepEqual(report([expense('Groceries', 50, '2026-12-01')]).items, [])
})

test('income and unrelated months are never counted as spending', () => {
  const result = report([
    expense('Groceries', 30),
    credit('Paycheck', 2000),
    expense('Shopping', 99, '2026-10-15')
  ])
  assert.equal(result.total, 30)
  assert.deepEqual(result.items.map(item => item.category), ['Groceries'])
})

test('refunds never inflate spending; they are reported separately and not subtracted', () => {
  const result = report([
    expense('Shopping', 100),
    credit('Shopping', 40),
    credit('Paycheck', 1500),
    credit('Shopping', 15, '2026-10-02')
  ])

  assert.equal(result.total, 100)
  assert.equal(result.items[0].amount, 100)
  assert.equal(result.refundTotal, 40)
  assert.equal(report([expense('Shopping', 100)]).refundTotal, 0)
})

test('transfers between accounts are excluded however they are marked', () => {
  const result = report([
    expense('Other', 500, '2026-11-10', { type: 'transfer' }),
    expense('Other', 500, '2026-11-10', { isTransfer: true }),
    expense('Other', 500, '2026-11-10', { transferId: 'abc' }),
    expense('Other', 500, '2026-11-10', { name: 'Transfer to Savings' }),
    expense('Other', 500, '2026-11-10', { name: 'Payment to Credit Card' }),
    expense('Other', 25, '2026-11-10', { name: 'Wire fee for transfer' })
  ])
  assert.equal(result.total, 25)
  assert.equal(report([credit('Other', 500, '2026-11-10', { type: 'transfer' })]).refundTotal, 0)
})

test('debt payments are excluded from spending', () => {
  const result = report([
    expense('Debt Payments', 214, '2026-11-10', { linkedDebtId: 1, linkedDebtPaymentId: 'p1' }),
    expense('Shopping', 20)
  ])
  assert.equal(result.total, 20)
  assert.deepEqual(result.items.map(item => item.category), ['Shopping'])
})

test('a bill that created linked transactions is counted once, cleared or not', () => {
  const link = 'bill:7:2026-11-05'
  const result = report([
    expense('Subscriptions', 15.99, '2026-11-05', { linkedOccurrenceId: link, linkedOccurrenceType: 'bill', cleared: false }),
    expense('Subscriptions', 15.99, '2026-11-05', { linkedOccurrenceId: link, linkedOccurrenceType: 'bill', cleared: true }),
    expense('Subscriptions', 15.99, '2026-12-05', { linkedOccurrenceId: 'bill:7:2026-12-05' })
  ])
  assert.equal(result.total, 15.99)
})

test('cleared and pending transactions both count, matching Budgets', () => {
  const result = report([expense('Groceries', 10, '2026-11-02', { cleared: true }), expense('Groceries', 5, '2026-11-03', { cleared: false })])
  assert.equal(result.total, 15)
})

test('expenses outside the active expense categories are left out, as Budgets does', () => {
  const result = getSpendingByCategory({
    transactions: [expense('Groceries', 10), expense('Old Category', 90), expense(undefined, 5)],
    month: '2026-11',
    categories: ['Groceries']
  })
  assert.equal(result.total, 10)
})

test('custom categories appear in the report', () => {
  const result = getSpendingByCategory({ transactions: [expense('Boat', 80), expense('Groceries', 20)], month: '2026-11', categories: [...categories, 'Boat'] })
  assert.deepEqual(result.items.map(item => item.category), ['Boat', 'Groceries'])
})

test('categories beyond the chart limit are merged into one neutral group that still adds up', () => {
  const many = Array.from({ length: 15 }, (_, index) => `Custom ${index}`)
  const transactions = many.map((category, index) => expense(category, 100 - index))
  const result = getSpendingByCategory({ transactions, month: '2026-11', categories: many })

  assert.equal(result.items.length, MAX_CHART_SLICES)
  const group = result.items.at(-1)
  assert.equal(group.isGroup, true)
  assert.equal(group.count, 15 - (MAX_CHART_SLICES - 1))
  assert.equal(result.items.reduce((sum, item) => sum + item.amount, 0), result.total)
  assert.equal(result.items.reduce((sum, item) => sum + item.percent, 0), 100)
  const colors = getChartColors(result.items, '#FFFFFF')
  assert.equal(new Set(colors.slice(0, -1)).size, MAX_CHART_SLICES - 1)
})

test('switching months changes the results and keeps months separate', () => {
  const transactions = [expense('Groceries', 50, '2026-10-30'), expense('Shopping', 70, '2026-11-01'), expense('Groceries', 10, '2026-12-31')]
  assert.deepEqual(report(transactions, '2026-10').items.map(item => item.category), ['Groceries'])
  assert.deepEqual(report(transactions, '2026-11').items.map(item => item.category), ['Shopping'])
  assert.equal(report(transactions, '2026-12').total, 10)
  assert.equal(report(transactions, '2026-09').total, 0)
})

test('month helpers handle year boundaries, labels, and bounds', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('2026-11', 0), '2026-11')
  assert.equal(shiftMonth('2026-11', -13), '2025-10')
  assert.equal(formatMonthLabel('2026-11'), 'November 2026')
  assert.equal(formatMonthLabel('2027-01'), 'January 2027')
  assert.deepEqual(getMonthBounds([], '2026-11'), { first: '2026-11', last: '2026-11' })
  assert.deepEqual(
    getMonthBounds([{ date: '2026-03-04' }, { date: '2027-02-01' }, { date: 'bad' }, {}], '2026-11'),
    { first: '2026-03', last: '2027-02' }
  )
})

test('transactions with missing or invalid dates are ignored without errors', () => {
  const result = report([expense('Groceries', 10, undefined), { ...expense('Groceries', 10), date: 'not-a-date' }, { ...expense('Groceries', 10), date: undefined }])
  assert.equal(result.total, 10)
})

test('doughnut segments cover the circle in order, and a single category fills it', () => {
  const items = [{ category: 'A', share: 0.5 }, { category: 'B', share: 0.3 }, { category: 'C', share: 0.2 }]
  const segments = getDoughnutSegments(items, 40)
  const circumference = 2 * Math.PI * 40

  assert.equal(segments[0].offset, -0)
  assert.ok(Math.abs(segments[1].offset + 0.5 * circumference) < 1e-9)
  assert.ok(Math.abs(segments[2].offset + 0.8 * circumference) < 1e-9)
  assert.ok(Math.abs(segments.reduce((sum, segment) => sum + segment.dash, 0) + 3 * 1.2 - circumference) < 1e-9)
  const single = getDoughnutSegments([{ category: 'A', share: 1 }], 40)
  assert.ok(Math.abs(single[0].dash - circumference) < 1e-9)
})

test('chart colors are readable on every preset theme card and on extreme custom card colors', () => {
  const cards = [...THEME_PRESETS.map(theme => theme.colors.card), '#000000', '#FFFFFF', '#808080', '#123456', '#FEDCBA', '#0F0', '#abc']
  const items = Array.from({ length: MAX_CHART_SLICES }, (_, index) => ({ isGroup: index === MAX_CHART_SLICES - 1 }))
  for (const card of cards) {
    const colors = getChartColors(items, card)
    assert.equal(colors.length, MAX_CHART_SLICES)
    for (const color of colors) {
      assert.ok(contrastRatio(color, card) >= 3, `${color} on ${card} is ${contrastRatio(color, card).toFixed(2)}`)
    }
  }
})

test('light and dark cards get different shades of the same hues', () => {
  const light = getChartColors([{}, {}, {}], '#FFFFFF')
  const dark = getChartColors([{}, {}, {}], '#2B333F')
  assert.notDeepEqual(light, dark)
  assert.equal(new Set(light).size, 3)
  assert.equal(new Set(dark).size, 3)
})

test('building a report never changes the transactions it reads', () => {
  const transactions = [expense('Groceries', 10), credit('Groceries', 5)]
  const before = JSON.stringify(transactions)
  report(transactions)
  assert.equal(JSON.stringify(transactions), before)
})
