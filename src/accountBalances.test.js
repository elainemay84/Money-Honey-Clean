import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateAccountBalances,
  normalizeTransactionAmount
} from './accountBalances.js'

const transactions = [
  { id: 1, date: '2026-11-06', amount: 1500, cleared: true },
  { id: 2, date: '2026-11-06', amount: -125, cleared: true },
  { id: 3, date: '2026-11-07', amount: -128, cleared: false },
  { id: 4, date: '2026-11-08', amount: -60, cleared: false },
]

test('calculates chronological balances for income and expenses', () => {
  const result = calculateAccountBalances(1500, transactions)

  assert.deepEqual(
    result.chronologicalRows.map(({ id, runningBalance }) => [id, runningBalance]),
    [[1, 3000], [2, 2875], [3, 2747], [4, 2687]]
  )
  assert.equal(result.clearedBalance, 2875)
  assert.equal(result.projectedBalance, 2687)
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
  assert.deepEqual(
    after.chronologicalRows.map(row => row.runningBalance),
    before.chronologicalRows.map(row => row.runningBalance)
  )
})

test('ascending and descending display order do not change balances', () => {
  const ascending = calculateAccountBalances(1500, transactions, 'asc')
  const descending = calculateAccountBalances(1500, transactions, 'desc')

  assert.deepEqual(ascending.rows.map(row => row.id), [1, 2, 3, 4])
  assert.deepEqual(descending.rows.map(row => row.id), [4, 3, 1, 2])
  assert.deepEqual(
    descending.rows.map(row => [row.id, row.runningBalance]),
    [[4, 2687], [3, 2747], [1, 3000], [2, 2875]]
  )
  assert.equal(descending.projectedBalance, ascending.projectedBalance)
})

test('same-date transactions use a stable ID order in either display direction', () => {
  const ascending = calculateAccountBalances(100, transactions.slice(0, 2), 'asc')
  const descending = calculateAccountBalances(100, transactions.slice(0, 2), 'desc')

  assert.deepEqual(ascending.rows.map(row => row.id), [1, 2])
  assert.deepEqual(descending.rows.map(row => row.id), [1, 2])
  assert.deepEqual(ascending.rows.map(row => row.runningBalance), [1600, 1475])
  assert.deepEqual(descending.rows.map(row => row.runningBalance), [1600, 1475])
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
