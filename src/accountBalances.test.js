import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  calculateAccountBalances,
  getNextTransactionSequence,
  moveTransactionToDate,
  normalizeTransactionAmount
} from './accountBalances.js'

const transactions = [
  { id: 1, date: '2026-11-06', amount: 1500, cleared: true },
  { id: 2, date: '2026-11-06', amount: -125, cleared: true },
  { id: 3, date: '2026-11-07', amount: -128, cleared: false },
  { id: 4, date: '2026-11-08', amount: -60, cleared: false },
]

test('opening reference date excludes already-included earlier transactions from the summary', () => {
  const referenceTransactions = [
    { id: 1, date: '2026-11-04', amount: 100, cleared: true },
    { id: 2, date: '2026-11-06', amount: -50, cleared: true },
    { id: 3, date: '2026-11-07', amount: 20, cleared: false },
  ]
  const result = calculateAccountBalances(
    1000,
    referenceTransactions,
    'asc',
    '2026-11-06'
  )

  assert.deepEqual(
    result.chronologicalRows.map(({ id, runningBalance }) => [id, runningBalance]),
    [[1, 1000], [2, 950], [3, 970]]
  )
  assert.equal(result.balance, 950)
  assert.equal(result.available, 970)
  assert.equal(result.unclearedBalance, 20)
})

test('Accounts Overview renders active account cards and separate management actions', async () => {
  const server = await createServer({
    configFile: './vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent'
  })
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  try {
    globalThis.localStorage = {
      getItem: () => 'desc',
      setItem: () => {}
    }

    const { default: Accounts } = await server.ssrLoadModule('/src/Accounts.jsx')
    const markup = renderToStaticMarkup(createElement(Accounts))
    const accountCards = [...markup.matchAll(/<button[^>]*data-account-id="(\d+)"/g)]

    assert.match(markup, /Accounts 🍯/)
    assert.match(markup, /aria-label="Manage accounts"/)
    assert.match(markup, /aria-label="Add account"/)
    assert.deepEqual(accountCards.map(([, id]) => Number(id)), [1, 2])
    assert.match(markup, /Everyday Checking/)
    assert.match(markup, /Savings/)
    assert.doesNotMatch(markup, /account-select/)
  } finally {
    await server.close()
    if (previousStorage) {
      Object.defineProperty(globalThis, 'localStorage', previousStorage)
    } else {
      delete globalThis.localStorage
    }
  }
})

test('register example displays each transaction balance after stable chronological same-day ordering', () => {
  const exampleTransactions = [
    { id: 4, name: 'Gas', date: '2026-11-04', amount: -60, cleared: false },
    { id: 2, name: 'Groceries', date: '2026-11-06', amount: -125, cleared: true },
    { id: 1, name: 'Paycheck', date: '2026-11-06', amount: 1500, cleared: true },
    { id: 3, name: 'Electric Bill', date: '2026-11-07', amount: -128, cleared: false },
  ]
  const ascending = calculateAccountBalances(1500, exampleTransactions, 'asc')
  const descending = calculateAccountBalances(1500, exampleTransactions, 'desc')

  assert.deepEqual(
    ascending.rows.map(({ name, runningBalance }) => [name, runningBalance]),
    [
      ['Gas', 1440],
      ['Paycheck', 2940],
      ['Groceries', 2815],
      ['Electric Bill', 2687],
    ]
  )
  assert.deepEqual(
    descending.rows.map(({ name, runningBalance }) => [name, runningBalance]),
    [
      ['Electric Bill', 2687],
      ['Groceries', 2815],
      ['Paycheck', 2940],
      ['Gas', 1440],
    ]
  )
  assert.equal(ascending.clearedBalance, 2875)
  assert.equal(ascending.projectedBalance, 2687)
})

test('calculates chronological balances for income and expenses', () => {
  const result = calculateAccountBalances(1500, transactions)

  assert.deepEqual(
    result.chronologicalRows.map(({ id, runningBalance }) => [id, runningBalance]),
    [[1, 3000], [2, 2875], [3, 2747], [4, 2687]]
  )
  assert.equal(result.clearedBalance, 2875)
  assert.equal(result.projectedBalance, 2687)
})

test('calculates Balance, Available, and signed net Uncleared independently', () => {
  const result = calculateAccountBalances(1500, transactions)

  assert.equal(result.balance, 2875)
  assert.equal(result.available, 2687)
  assert.equal(result.unclearedBalance, -188)

  const updatedOpeningBalance = calculateAccountBalances(2000, transactions)
  assert.equal(updatedOpeningBalance.balance, 3375)
  assert.equal(updatedOpeningBalance.available, 3187)
  assert.equal(updatedOpeningBalance.unclearedBalance, -188)

  const unclearedIncome = calculateAccountBalances(100, [
    { id: 1, date: '2026-11-01', amount: 50, cleared: false },
  ])
  assert.equal(unclearedIncome.balance, 100)
  assert.equal(unclearedIncome.available, 150)
  assert.equal(unclearedIncome.unclearedBalance, 50)
})

test('expense inputs always reduce balance and income inputs always increase it', () => {
  assert.equal(normalizeTransactionAmount(20, 'expense'), -20)
  assert.equal(normalizeTransactionAmount(-20, 'expense'), -20)
  assert.equal(normalizeTransactionAmount(1500, 'income'), 1500)
  assert.equal(normalizeTransactionAmount(-1500, 'income'), 1500)

  const expensesAndDeposit = [
    { id: 1, date: '2026-11-01', amount: normalizeTransactionAmount(-20, 'expense'), cleared: true },
    { id: 2, date: '2026-11-02', amount: normalizeTransactionAmount(128, 'expense'), cleared: true },
    { id: 3, date: '2026-11-03', amount: normalizeTransactionAmount(60, 'expense'), cleared: false },
    { id: 4, date: '2026-11-04', amount: normalizeTransactionAmount(-1500, 'income'), cleared: false },
  ]
  const result = calculateAccountBalances(2875, expensesAndDeposit)
  const descendingResult = calculateAccountBalances(2875, expensesAndDeposit, 'desc')

  assert.deepEqual(result.chronologicalRows.map(row => row.runningBalance), [2855, 2727, 2667, 4167])
  assert.deepEqual(
    descendingResult.rows.map(row => row.runningBalance),
    [4167, 2667, 2727, 2855]
  )
  assert.equal(result.projectedBalance, 4167)
  assert.equal(descendingResult.projectedBalance, 4167)
  assert.equal(result.clearedBalance, 2727)
})

test('date changes recalculate all affected balances chronologically', () => {
  const changedTransactions = transactions.map(transaction =>
    transaction.id === 4 ? { ...transaction, date: '2026-11-06' } : transaction
  )
  const result = calculateAccountBalances(1500, changedTransactions)

  assert.deepEqual(
    result.chronologicalRows.map(({ id, runningBalance }) => [id, runningBalance]),
    [[1, 3000], [2, 2875], [4, 2815], [3, 2687]]
  )
})

test('inserting a transaction between others and changing its date reorders and recalculates balances', () => {
  const initialTransactions = [
    { id: 1, date: '2026-11-01', amount: 100, cleared: true },
    { id: 2, date: '2026-11-03', amount: -50, cleared: false },
  ]
  const inserted = [
    ...initialTransactions,
    { id: 3, date: '2026-11-02', amount: -20, cleared: false },
  ]
  const afterInsert = calculateAccountBalances(1000, inserted)

  assert.deepEqual(
    afterInsert.chronologicalRows.map(({ id, runningBalance }) => [id, runningBalance]),
    [[1, 1100], [3, 1080], [2, 1030]]
  )

  const moved = inserted.map(transaction =>
    transaction.id === 3 ? { ...transaction, date: '2026-11-04' } : transaction
  )
  const afterDateChange = calculateAccountBalances(1000, moved)

  assert.deepEqual(
    afterDateChange.chronologicalRows.map(({ id, runningBalance }) => [id, runningBalance]),
    [[1, 1100], [2, 1050], [3, 1030]]
  )
})

test('clearing changes cleared total without changing projected total or ledger balances', () => {
  const changedTransactions = transactions.map(transaction =>
    transaction.id === 3 ? { ...transaction, cleared: true } : transaction
  )
  const before = calculateAccountBalances(1500, transactions)
  const after = calculateAccountBalances(1500, changedTransactions)

  assert.equal(after.clearedBalance, before.clearedBalance - 128)
  assert.equal(after.projectedBalance, before.projectedBalance)
  assert.equal(after.balance, before.balance - 128)
  assert.equal(after.available, before.available)
  assert.equal(after.unclearedBalance, before.unclearedBalance + 128)
  assert.deepEqual(
    after.chronologicalRows.map(row => row.runningBalance),
    before.chronologicalRows.map(row => row.runningBalance)
  )
})

test('moving transaction dates recalculates running rows without changing the three balances', () => {
  const before = calculateAccountBalances(1500, transactions)
  const movedTransactions = transactions.map(transaction =>
    transaction.id === 4 ? { ...transaction, date: '2026-11-06' } : transaction
  )
  const after = calculateAccountBalances(1500, movedTransactions)

  assert.notDeepEqual(
    after.chronologicalRows.map(row => row.runningBalance),
    before.chronologicalRows.map(row => row.runningBalance)
  )
  assert.equal(after.balance, before.balance)
  assert.equal(after.available, before.available)
  assert.equal(after.unclearedBalance, before.unclearedBalance)
})

test('ascending and descending display order do not change balances', () => {
  const ascending = calculateAccountBalances(1500, transactions, 'asc')
  const descending = calculateAccountBalances(1500, transactions, 'desc')

  assert.deepEqual(ascending.rows.map(row => row.id), [1, 2, 3, 4])
  assert.deepEqual(descending.rows.map(row => row.id), [4, 3, 2, 1])
  assert.deepEqual(
    descending.rows.map(row => [row.id, row.runningBalance]),
    [[4, 2687], [3, 2747], [2, 2875], [1, 3000]]
  )
  assert.equal(descending.projectedBalance, ascending.projectedBalance)
})

test('each displayed demo row retains its post-transaction running balance in either sort order', () => {
  const expectedBalancesById = new Map([
    [1, 3000],
    [2, 2875],
    [3, 2747],
    [4, 2687],
  ])
  const ascending = calculateAccountBalances(1500, transactions, 'asc')
  const descending = calculateAccountBalances(1500, transactions, 'desc')

  for (const row of [...ascending.rows, ...descending.rows]) {
    assert.equal(
      row.runningBalance,
      expectedBalancesById.get(row.id),
      `transaction ${row.id} should retain its chronological post-transaction balance`
    )
  }

  assert.deepEqual(
    descending.rows.map(row => [row.id, row.amount, row.runningBalance]),
    [
      [4, -60, 2687],
      [3, -128, 2747],
      [2, -125, 2875],
      [1, 1500, 3000],
    ]
  )
})

test('same-date sequence order takes precedence over transaction ID in either display direction', () => {
  const sameDateTransactions = [
    { id: 2, sequence: 20, date: '2026-11-06', amount: -125, cleared: true },
    { id: 1, sequence: 10, date: '2026-11-06', amount: 1500, cleared: true },
  ]
  const ascending = calculateAccountBalances(100, sameDateTransactions, 'asc')
  const descending = calculateAccountBalances(100, sameDateTransactions, 'desc')

  assert.deepEqual(ascending.rows.map(row => row.id), [1, 2])
  assert.deepEqual(descending.rows.map(row => row.id), [2, 1])
  assert.deepEqual(ascending.rows.map(row => row.runningBalance), [1600, 1475])
  assert.deepEqual(descending.rows.map(row => row.runningBalance), [1475, 1600])
})

test('moving a transaction onto a date with multiple transactions preserves stable ordering and recalculates balances', () => {
  const startingTransactions = [
    { id: 1, date: '2026-11-01', amount: 100, cleared: true },
    { id: 2, date: '2026-11-01', amount: -25, cleared: true },
    { id: 3, date: '2026-11-02', amount: -40, cleared: false },
    { id: 4, date: '2026-11-03', amount: 200, cleared: false },
  ]
  const beforeMove = calculateAccountBalances(1000, startingTransactions)
  const movedTransactions = startingTransactions.map(transaction =>
    transaction.id === 4 ? { ...transaction, date: '2026-11-01' } : transaction
  )
  const ascending = calculateAccountBalances(1000, movedTransactions, 'asc')
  const descending = calculateAccountBalances(1000, movedTransactions, 'desc')

  assert.deepEqual(
    beforeMove.chronologicalRows.map(row => row.runningBalance),
    [1100, 1075, 1035, 1235]
  )
  assert.deepEqual(
    ascending.rows.map(({ id, runningBalance }) => [id, runningBalance]),
    [[1, 1100], [2, 1075], [4, 1275], [3, 1235]]
  )
  assert.deepEqual(
    descending.rows.map(({ id, runningBalance }) => [id, runningBalance]),
    [[3, 1235], [4, 1275], [2, 1075], [1, 1100]]
  )
  assert.equal(ascending.projectedBalance, 1235)
  assert.equal(descending.projectedBalance, 1235)
  assert.equal(ascending.clearedBalance, 1075)
  assert.equal(descending.clearedBalance, 1075)
})

test('moving Gas onto Nov 6 inserts it after existing entries and preserves each transaction balance', () => {
  const startingTransactions = [
    { id: 1, sequence: 1, name: 'Paycheck', date: '2026-11-06', amount: 1500, cleared: true },
    { id: 2, sequence: 2, name: 'Groceries', date: '2026-11-06', amount: -125, cleared: true },
    { id: 3, sequence: 3, name: 'Electric', date: '2026-11-07', amount: -128, cleared: false },
    { id: 4, sequence: 4, name: 'Gas', date: '2026-11-08', amount: -60, cleared: false },
  ]
  const afterMove = moveTransactionToDate(startingTransactions, 4, '2026-11-06')
  const ascending = calculateAccountBalances(0, afterMove, 'asc', '2026-11-06')
  const descending = calculateAccountBalances(0, afterMove, 'desc', '2026-11-06')
  const expectedBalances = new Map([
    [1, 1500],
    [2, 1375],
    [4, 1315],
    [3, 1187],
  ])

  assert.deepEqual(ascending.rows.map(row => row.id), [1, 2, 4, 3])
  assert.deepEqual(descending.rows.map(row => row.id), [3, 4, 2, 1])
  for (const row of [...ascending.rows, ...descending.rows]) {
    assert.equal(row.runningBalance, expectedBalances.get(row.id))
  }
  assert.equal(afterMove.find(transaction => transaction.id === 4).sequence, 5)

  const movedBack = moveTransactionToDate(afterMove, 4, '2026-11-08')
  const movedAgain = moveTransactionToDate(movedBack, 4, '2026-11-06')
  const movedRepeatedly = moveTransactionToDate(movedAgain, 4, '2026-11-08')
  const finalMoveToNov6 = moveTransactionToDate(movedRepeatedly, 4, '2026-11-06')
  const repeatedResult = calculateAccountBalances(0, finalMoveToNov6, 'asc', '2026-11-06')

  assert.deepEqual(repeatedResult.rows.map(row => row.id), [1, 2, 4, 3])
  assert.deepEqual(
    repeatedResult.rows.map(row => row.runningBalance),
    [1500, 1375, 1315, 1187]
  )
  assert.equal(new Set(finalMoveToNov6.map(transaction => transaction.sequence)).size, 4)
})

test('new same-day transactions receive a later sequence and appear first in Newest First', () => {
  const existing = [
    { id: 1, sequence: 1, name: 'Paycheck', date: '2026-11-06', amount: 1500, cleared: true },
    { id: 2, sequence: 2, name: 'Groceries', date: '2026-11-06', amount: -125, cleared: true },
  ]
  const newExpense = {
    id: 3,
    sequence: getNextTransactionSequence(existing, 2),
    name: 'New expense',
    date: '2026-11-06',
    amount: -20,
    cleared: false
  }
  const ledger = [...existing, newExpense]
  const ascending = calculateAccountBalances(0, ledger, 'asc', '2026-11-06')
  const descending = calculateAccountBalances(0, ledger, 'desc', '2026-11-06')

  assert.deepEqual(
    ascending.rows.map(({ name, runningBalance }) => [name, runningBalance]),
    [['Paycheck', 1500], ['Groceries', 1375], ['New expense', 1355]]
  )
  assert.deepEqual(
    descending.rows.map(({ name, runningBalance }) => [name, runningBalance]),
    [['New expense', 1355], ['Groceries', 1375], ['Paycheck', 1500]]
  )
  assert.equal(newExpense.sequence, 3)
})

test('moving an expense away and back gives it a new latest sequence for the destination date', () => {
  const startingTransactions = [
    { id: 1, sequence: 1, name: 'Paycheck', date: '2026-11-06', amount: 1500, cleared: true },
    { id: 2, sequence: 2, name: 'Groceries', date: '2026-11-06', amount: -125, cleared: true },
    { id: 3, sequence: 3, name: 'New expense', date: '2026-11-06', amount: -20, cleared: false },
    { id: 4, sequence: 4, name: 'Electric', date: '2026-11-07', amount: -128, cleared: false },
  ]
  const movedAway = moveTransactionToDate(startingTransactions, 3, '2026-11-07', 5)
  const movedBack = moveTransactionToDate(movedAway, 3, '2026-11-06', 6)
  const asc = calculateAccountBalances(0, movedBack, 'asc', '2026-11-06')
  const desc = calculateAccountBalances(0, movedBack, 'desc', '2026-11-06')

  assert.deepEqual(asc.rows.map(row => row.id), [1, 2, 3, 4])
  assert.deepEqual(asc.rows.map(row => row.runningBalance), [1500, 1375, 1355, 1227])
  assert.deepEqual(desc.rows.map(row => row.id), [4, 3, 2, 1])
  assert.deepEqual(desc.rows.map(row => row.runningBalance), [1227, 1355, 1375, 1500])
  assert.equal(movedBack.find(transaction => transaction.id === 3).sequence, 6)
})

test('added, edited, and deleted transactions are reflected in recalculated balances', () => {
  const added = [...transactions, {
    id: 5,
    date: '2026-11-05',
    amount: 200,
    cleared: false
  }]
  const afterAdd = calculateAccountBalances(1500, added)
  const afterEdit = calculateAccountBalances(1500, added.map(transaction =>
    transaction.id === 5 ? { ...transaction, amount: 300 } : transaction
  ))
  const afterDelete = calculateAccountBalances(
    1500,
    added.filter(transaction => transaction.id !== 5)
  )

  assert.equal(afterAdd.chronologicalRows[0].runningBalance, 1700)
  assert.equal(afterEdit.chronologicalRows[0].runningBalance, 1800)
  assert.equal(afterDelete.chronologicalRows[0].id, 1)
  assert.equal(afterDelete.projectedBalance, 2687)
})
