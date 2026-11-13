import assert from 'node:assert/strict'
import test from 'node:test'
import { getBudgetSpendingByCategory } from './budgetData.js'
import { EXPENSE_CATEGORIES } from './categoryData.js'
import {
  MAX_CHART_SLICES,
  contrastRatio,
  formatMonthLabel,
  getBarShares,
  getChartColors,
  getIncomeExpenseColors,
  getIncomeVsExpenses,
  getReportFlags,
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

test('the totals equal the Budgets calculation for the same month, including refunds and uncategorized spending', () => {
  const transactions = [
    expense('Groceries', 40),
    expense('Groceries', 12.34, '2026-11-02', { cleared: false }),
    expense('Housing & Utilities', 900, '2026-11-01', { linkedOccurrenceId: 'bill:1:2026-11-01' }),
    expense('Housing & Utilities', 900, '2026-11-01', { linkedOccurrenceId: 'bill:1:2026-11-01' }),
    expense('Debt Payments', 214),
    expense('Shopping', 14, '2026-11-09', { linkedDebtId: 3, linkedDebtPaymentId: 'p2' }),
    expense(undefined, 18.5),
    expense('Shopping', 75, '2026-10-30'),
    credit('Groceries', 10),
    credit('Paycheck', 1500)
  ]
  const budgets = getBudgetSpendingByCategory({ transactions, today: '2026-11-15', categories })
  const result = report(transactions)

  assert.deepEqual(Object.fromEntries(result.items.map(item => [item.category, item.amount])), {
    'Housing & Utilities': 900,
    Groceries: 42.34,
    Uncategorized: 18.5
  })
  assert.deepEqual(Object.fromEntries(result.items.map(item => [item.category, item.amount])), budgets)
  assert.equal(result.total, 960.84)
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

test('refunds reduce the spending of their own category and never add to it', () => {
  const result = report([
    expense('Shopping', 100),
    credit('Shopping', 40),
    expense('Groceries', 60),
    credit('Paycheck', 1500),
    credit('Shopping', 15, '2026-10-02')
  ])

  assert.equal(result.total, 120)
  assert.deepEqual(result.items.map(item => [item.category, item.amount]), [['Groceries', 60], ['Shopping', 60]])
  assert.equal(result.refundTotal, 40)
  assert.equal(result.unmatchedRefundTotal, 0)
  assert.equal(report([expense('Shopping', 100)]).refundTotal, 0)
})

test('a refund larger than the category spending never shows negative spending and is reported as unmatched', () => {
  const result = report([expense('Shopping', 30), credit('Shopping', 80), expense('Groceries', 20)])
  assert.deepEqual(result.items.map(item => [item.category, item.amount]), [['Groceries', 20], ['Shopping', 0]].filter(([, amount]) => amount > 0))
  assert.equal(result.total, 20)
  assert.equal(result.refundTotal, 30)
  assert.equal(result.unmatchedRefundTotal, 50)
  assert.equal(report([credit('Shopping', 25)]).total, 0)
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

test('expenses with no usable category are shown as Uncategorized instead of being dropped', () => {
  const result = getSpendingByCategory({
    transactions: [expense('Groceries', 10), expense('Old Category', 90), expense(undefined, 5), expense('   ', 1)],
    month: '2026-11',
    categories: ['Groceries']
  })
  assert.equal(result.total, 106)
  assert.deepEqual(result.items.map(item => [item.category, item.amount]), [['Uncategorized', 96], ['Groceries', 10]])
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

// ---- Income vs. Expenses ----
const cashFlow = (transactions, month = '2026-11', cats = categories) => getIncomeVsExpenses({ transactions, month, categories: cats })

test('income, expenses, and net cash flow come from the month\'s recorded transactions', () => {
  const result = cashFlow([
    credit('Paycheck', 2000, '2026-11-01'),
    credit('Other Income', 250.5, '2026-11-15'),
    expense('Groceries', 120.25),
    expense('Housing & Utilities', 900),
    expense('Paycheck', 0, '2026-11-02'),
    credit('Paycheck', 5000, '2026-10-31'),
    expense('Groceries', 70, '2026-12-01')
  ])

  assert.equal(result.income, 2250.5)
  assert.equal(result.expenses, 1020.25)
  assert.equal(result.net, 1230.25)
  assert.equal(result.refundTotal, 0)
  assert.equal(result.hasActivity, true)
})

test('negative net cash flow is reported when expenses exceed income', () => {
  const result = cashFlow([credit('Paycheck', 500), expense('Housing & Utilities', 900)])
  assert.equal(result.net, -400)
  assert.equal(cashFlow([credit('Paycheck', 500), expense('Groceries', 500)]).net, 0)
})

test('empty months and months of only excluded items have no activity', () => {
  assert.deepEqual(cashFlow([]), {
    month: '2026-11', income: 0, expenses: 0, net: 0, debtPayments: 0, refundTotal: 0, unmatchedRefundTotal: 0, hasActivity: false
  })
  const onlyTransfers = cashFlow([expense('Other', 300, '2026-11-02', { type: 'transfer' }), credit('Other', 300, '2026-11-02', { type: 'transfer' })])
  assert.equal(onlyTransfers.hasActivity, false)
  assert.equal(cashFlow([credit('Paycheck', 100, '2026-10-02')]).hasActivity, false)
})

test('transfers are excluded on both the money-in and money-out side', () => {
  const result = cashFlow([
    expense('Other', 500, '2026-11-03', { type: 'transfer' }),
    credit('Other Income', 500, '2026-11-03', { isTransfer: true }),
    expense('Other', 500, '2026-11-03', { transferId: 't1' }),
    credit('Other Income', 500, '2026-11-03', { transferId: 't1' }),
    expense('Other', 500, '2026-11-03', { name: 'Transfer to Savings' }),
    credit('Other Income', 500, '2026-11-03', { name: 'Transfer from Checking' }),
    expense('Other', 500, '2026-11-03', { name: 'Payment to Credit Card' }),
    credit('Paycheck', 1000),
    expense('Groceries', 40)
  ])
  assert.equal(result.income, 1000)
  assert.equal(result.expenses, 40)
})

test('uncategorized and unknown-category transactions count toward overall cash flow', () => {
  const result = cashFlow([
    expense(undefined, 30),
    expense('Old Deleted Category', 70),
    credit(undefined, 200),
    credit('Mystery', 50),
    expense('Groceries', 10)
  ])
  assert.equal(result.expenses, 110)
  assert.equal(result.income, 250)
  assert.equal(result.refundTotal, 0)
})

test('debt payments are reported separately and never counted as expenses or income', () => {
  const result = cashFlow([
    expense('Debt Payments', 214, '2026-11-10', { name: 'Debt payment · Card', linkedDebtId: 1, linkedDebtPaymentId: 'p1', transactionType: 'debt-payment' }),
    expense('Housing & Utilities', 150, '2026-11-01', { linkedOccurrenceId: 'bill:1:2026-11-01', linkedDebtId: 2 }),
    expense('Groceries', 50),
    credit('Paycheck', 2000)
  ])
  assert.equal(result.expenses, 50)
  assert.equal(result.debtPayments, 364)
  assert.equal(result.income, 2000)
  assert.equal(result.net, 1950)
  assert.equal(result.hasActivity, true)
  assert.equal(cashFlow([expense('Debt Payments', 214, '2026-11-10', { linkedDebtId: 1 })]).hasActivity, true)
})

test('credit card payments linked to a debt are not double counted when the card purchases are expenses', () => {
  const result = cashFlow([
    expense('Shopping', 120),
    expense('Eating Out', 80),
    expense('Other', 200, '2026-11-20', { name: 'Chase Visa payment', linkedDebtId: 4, linkedDebtPaymentId: 'p7', transactionType: 'debt-payment' })
  ])
  assert.equal(result.expenses, 200)
  assert.equal(result.debtPayments, 200)
  assert.equal(report([
    expense('Shopping', 120), expense('Eating Out', 80),
    expense('Other', 200, '2026-11-20', { name: 'Chase Visa payment', linkedDebtId: 4 })
  ]).total, 200)
})

test('credits on a credit card account are not income, and card-account refunds still reduce spending', () => {
  const accounts = [{ id: 1, type: 'Checking' }, { id: 2, type: 'Credit Card' }]
  const result = getIncomeVsExpenses({
    transactions: [
      credit('Paycheck', 2000),
      credit('Paycheck', 500, '2026-11-12', { accountId: 2, name: 'Payment received' }),
      expense('Shopping', 100, '2026-11-05', { accountId: 2 }),
      credit('Shopping', 25, '2026-11-06', { accountId: 2 })
    ],
    month: '2026-11',
    categories,
    accounts
  })
  assert.equal(result.income, 2000)
  assert.equal(result.expenses, 75)
})

test('bills and income already represented by transactions are counted once, cleared or not', () => {
  const bill = 'bill:3:2026-11-05'
  const pay = 'income:1:2026-11-01'
  const result = cashFlow([
    expense('Subscriptions', 15.99, '2026-11-05', { linkedOccurrenceId: bill, cleared: false }),
    expense('Subscriptions', 15.99, '2026-11-05', { linkedOccurrenceId: bill, cleared: true }),
    credit('Paycheck', 1500, '2026-11-01', { linkedOccurrenceId: pay, cleared: false }),
    credit('Paycheck', 1500, '2026-11-01', { linkedOccurrenceId: pay, cleared: true })
  ])
  assert.equal(result.expenses, 15.99)
  assert.equal(result.income, 1500)
})

test('a duplicate link that straddles a month boundary is resolved the same way as Budgets', () => {
  const link = 'bill:9:2026-11-30'
  const transactions = [
    expense('Subscriptions', 20, '2026-11-30', { linkedOccurrenceId: link }),
    expense('Subscriptions', 20, '2026-12-01', { linkedOccurrenceId: link })
  ]
  assert.equal(cashFlow(transactions, '2026-11').expenses, 20)
  assert.equal(cashFlow(transactions, '2026-12').expenses, 0)
  assert.equal(report(transactions, '2026-12').total, 0)
})

test('refunds reduce expenses and are never counted as new income', () => {
  const result = cashFlow([
    expense('Shopping', 100),
    credit('Shopping', 40),
    credit('Paycheck', 1000)
  ])
  assert.equal(result.expenses, 60)
  assert.equal(result.income, 1000)
  assert.equal(result.refundTotal, 40)
  assert.equal(result.net, 940)
})

test('an unmatched refund is neither income nor an expense reduction', () => {
  const result = cashFlow([expense('Shopping', 10), credit('Shopping', 50), credit('Paycheck', 1000)])
  assert.equal(result.expenses, 0)
  assert.equal(result.income, 1000)
  assert.equal(result.unmatchedRefundTotal, 40)
  assert.equal(result.net, 1000)
})

test('a payment and its reversal both stay on the record and cancel out in net cash flow', () => {
  const result = cashFlow([expense('Shopping', 60), credit('Shopping', 60), credit('Paycheck', 500)])
  assert.equal(result.net, 500)
})

test('expenses always equal the Spending by Category total, because both use the same rules', () => {
  const transactions = [
    expense('Groceries', 80),
    expense('Gas & Fuel', 20),
    expense('Debt Payments', 214),
    expense(undefined, 5),
    expense('Old Category', 7),
    credit('Gas & Fuel', 4),
    credit('Paycheck', 900)
  ]
  const flow = cashFlow(transactions)
  assert.equal(flow.expenses, report(transactions).total)
  assert.equal(flow.expenses, 108)
  assert.equal(flow.debtPayments, 214)
})

test('money is added in cents and invalid records are ignored', () => {
  const result = cashFlow([
    credit('Paycheck', 0.1),
    credit('Paycheck', 0.2),
    expense('Groceries', 0.07),
    { id: 900, date: '2026-11-04', amount: 'abc', category: 'Groceries' },
    { id: 901, date: 'bad-date', amount: -50, category: 'Groceries' },
    { id: 902, amount: -50, category: 'Groceries' }
  ])
  assert.equal(result.income, 0.3)
  assert.equal(result.expenses, 0.07)
  assert.equal(result.net, 0.23)
})

test('switching months gives each month its own totals', () => {
  const transactions = [
    credit('Paycheck', 1000, '2026-09-30'), expense('Groceries', 100, '2026-09-30'),
    credit('Paycheck', 2000, '2026-10-01'), expense('Groceries', 700, '2026-10-31'),
    credit('Paycheck', 3000, '2026-11-01')
  ]
  assert.deepEqual(['2026-09', '2026-10', '2026-11', '2026-12'].map(month => cashFlow(transactions, month).net), [900, 1300, 3000, 0])
})

test('income vs expenses never changes the transactions it reads', () => {
  const transactions = [credit('Paycheck', 5), expense('Groceries', 2, '2026-11-02', { linkedOccurrenceId: 'x' })]
  const before = JSON.stringify(transactions)
  cashFlow(transactions)
  assert.equal(JSON.stringify(transactions), before)
})

test('bar lengths are relative to the larger amount and stay visible when small', () => {
  assert.deepEqual(getBarShares(1000, 500), { income: 1, expenses: 0.5 })
  assert.deepEqual(getBarShares(0, 0), { income: 0, expenses: 0 })
  assert.deepEqual(getBarShares(0, 80), { income: 0, expenses: 1 })
  assert.equal(getBarShares(10000, 1).expenses, 0.02)
})

test('income and expense bar colors are readable on every preset theme card and extremes', () => {
  const cards = [...THEME_PRESETS.map(theme => theme.colors.card), '#000000', '#FFFFFF', '#808080', '#0F0']
  for (const card of cards) {
    const { income, expenses } = getIncomeExpenseColors(card)
    assert.ok(contrastRatio(income, card) >= 3, `income ${income} on ${card}`)
    assert.ok(contrastRatio(expenses, card) >= 3, `expenses ${expenses} on ${card}`)
    assert.notEqual(income, expenses)
  }
})

test('report flags list records that need a category or type without changing anything', () => {
  const transactions = [
    expense(undefined, 12, '2026-11-03'),
    expense('Gone', 9, '2026-11-04'),
    expense('Other', 300, '2026-11-05', { name: 'Chase Visa payment' }),
    credit('Other Income', 35, '2026-11-06', { name: 'Refund from store' }),
    credit('Shopping', 90, '2026-11-07'),
    expense('Groceries', 40, '2026-10-02')
  ]
  const before = JSON.stringify(transactions)
  const flags = getReportFlags({ transactions, month: '2026-11', categories })

  assert.deepEqual(flags.map(flag => flag.reason), ['uncategorized', 'unknown-category', 'possible-card-payment', 'possible-refund', 'unmatched-refund'])
  assert.equal(JSON.stringify(transactions), before)
  assert.deepEqual(getReportFlags({ transactions, month: '2026-09', categories }), [])
})
