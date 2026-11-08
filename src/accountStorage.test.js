import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOccurrenceTransaction,
  linkExistingOccurrenceTransaction,
  loadSavedAccountData,
  saveAccountData,
  setOccurrenceTransactionCleared,
  unlinkOccurrenceTransaction,
  updateOccurrenceTransaction
} from './accountStorage.js'
import { calculateAccountBalances } from './accountBalances.js'
import {
  getBillOccurrences,
  getIncomeSummary,
  getIncomeOccurrences,
  getPaydayBillSummary
} from './billData.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
}

function seedAccounts(storage) {
  saveAccountData([
    { id: 1, name: 'Checking', openingBalance: 1000, openingDate: '2026-01-01', archived: false },
    { id: 2, name: 'Savings', openingBalance: 500, openingDate: '2026-01-01', archived: false }
  ], [], storage)
}

const billOccurrence = {
  id: 7,
  occurrenceId: 'bill:7:2026-04-10',
  scheduledDate: '2026-04-10',
  dueDate: '2026-04-10',
  name: 'Electric',
  amount: 80,
  accountId: 1
}

const incomeOccurrence = {
  id: 3,
  occurrenceId: 'income:3:2026-04-10',
  scheduledDate: '2026-04-10',
  dueDate: '2026-04-10',
  name: 'Paycheck',
  amount: 1200,
  accountId: 1
}

test('paying a bill creates one negative uncleared linked transaction and repeated requests reuse it', () => {
  const storage = createStorage()
  seedAccounts(storage)

  const first = createOccurrenceTransaction('out', billOccurrence, '2026-04-12', storage)
  const repeated = createOccurrenceTransaction('out', billOccurrence, '2026-04-12', storage)
  const data = loadSavedAccountData(storage)

  assert.equal(first.status, 'created')
  assert.equal(repeated.status, 'linked')
  assert.equal(data.transactions.length, 1)
  assert.deepEqual({
    amount: data.transactions[0].amount,
    name: data.transactions[0].name,
    date: data.transactions[0].date,
    cleared: data.transactions[0].cleared,
    occurrenceId: data.transactions[0].linkedOccurrenceId
  }, {
    amount: -80,
    name: 'Electric',
    date: '2026-04-12',
    cleared: false,
    occurrenceId: billOccurrence.occurrenceId
  })

  const occurrence = getBillOccurrences([{
    id: 7,
    name: 'Electric',
    amount: 80,
    dueDate: '2026-04-10',
    frequency: 'one-time',
    accountId: 1,
    paymentHistory: []
  }], new Date(Date.UTC(2026, 3, 1)), data.transactions)[0]
  assert.equal(occurrence.paid, true)
  assert.equal(occurrence.cleared, false)
  assert.equal(calculateAccountBalances(1000, data.transactions).available, 920)
})

test('receiving income creates one positive linked transaction and reload keeps its received status', () => {
  const storage = createStorage()
  seedAccounts(storage)
  const income = {
    id: 3,
    name: 'Paycheck',
    amount: 1200,
    dueDate: '2026-04-10',
    frequency: 'one-time',
    accountId: 1,
    active: true,
    archived: false,
    paymentHistory: []
  }

  const created = createOccurrenceTransaction('in', incomeOccurrence, '2026-04-11', storage)
  const reloaded = loadSavedAccountData(storage)
  const occurrence = getIncomeOccurrences([income], new Date(Date.UTC(2026, 3, 1)), reloaded.transactions)[0]

  assert.equal(created.transaction.amount, 1200)
  assert.equal(created.transaction.date, '2026-04-11')
  assert.equal(created.transaction.cleared, false)
  assert.equal(occurrence.status, 'received')
  assert.equal(occurrence.cleared, false)
  assert.equal(calculateAccountBalances(1000, reloaded.transactions).available, 2200)

  setOccurrenceTransactionCleared(created.transaction.id, true, storage)
  let incomeAfterClear = getIncomeOccurrences(
    [income],
    new Date(Date.UTC(2026, 3, 1)),
    loadSavedAccountData(storage).transactions
  )[0]
  assert.equal(incomeAfterClear.status, 'received')
  assert.equal(incomeAfterClear.cleared, true)
  setOccurrenceTransactionCleared(created.transaction.id, false, storage)
  incomeAfterClear = getIncomeOccurrences(
    [income],
    new Date(Date.UTC(2026, 3, 1)),
    loadSavedAccountData(storage).transactions
  )[0]
  assert.equal(incomeAfterClear.status, 'received')
  assert.equal(incomeAfterClear.cleared, false)
})

test('clearing and unclearing a transaction immediately controls its linked occurrence and Home summary', () => {
  const storage = createStorage()
  seedAccounts(storage)
  const bill = {
    id: 7,
    name: 'Electric',
    amount: 80,
    dueDate: '2026-04-10',
    frequency: 'one-time',
    accountId: 1,
    paymentHistory: []
  }
  const { transaction } = createOccurrenceTransaction('out', billOccurrence, '2026-04-10', storage)
  const period = { startDate: '2026-04-01', endDate: '2026-04-30' }

  let data = loadSavedAccountData(storage)
  let occurrence = getBillOccurrences([bill], new Date(Date.UTC(2026, 3, 1)), data.transactions)[0]
  let summary = getPaydayBillSummary([bill], period, data.transactions)
  assert.equal(occurrence.paid, true)
  assert.equal(occurrence.cleared, false)
  assert.deepEqual([summary.totalDue, summary.cleared, summary.remaining], [80, 0, 80])

  setOccurrenceTransactionCleared(transaction.id, true, storage)
  data = loadSavedAccountData(storage)
  occurrence = getBillOccurrences([bill], new Date(Date.UTC(2026, 3, 1)), data.transactions)[0]
  summary = getPaydayBillSummary([bill], period, data.transactions)
  assert.equal(occurrence.cleared, true)
  assert.deepEqual([summary.totalDue, summary.cleared, summary.remaining], [80, 80, 0])

  setOccurrenceTransactionCleared(transaction.id, false, storage)
  data = loadSavedAccountData(storage)
  occurrence = getBillOccurrences([bill], new Date(Date.UTC(2026, 3, 1)), data.transactions)[0]
  summary = getPaydayBillSummary([bill], period, data.transactions)
  assert.equal(occurrence.paid, true)
  assert.equal(occurrence.cleared, false)
  assert.deepEqual([summary.totalDue, summary.cleared, summary.remaining], [80, 0, 80])
})

test('an existing matching transaction requires explicit linking and cannot be linked to two occurrences', () => {
  const storage = createStorage()
  seedAccounts(storage)
  saveAccountData([
    { id: 1, name: 'Checking', openingBalance: 1000, openingDate: '2026-01-01', archived: false }
  ], [{
    id: 12,
    sequence: 12,
    accountId: 1,
    name: 'Electric',
    amount: -80,
    date: '2026-04-12',
    cleared: false
  }], storage)

  const result = createOccurrenceTransaction('out', billOccurrence, '2026-04-12', storage)
  assert.equal(result.status, 'matches')
  assert.equal(loadSavedAccountData(storage).transactions.length, 1)

  const linked = linkExistingOccurrenceTransaction('out', billOccurrence, 12, storage)
  assert.equal(linked.linkedOccurrenceId, billOccurrence.occurrenceId)
  assert.throws(
    () => linkExistingOccurrenceTransaction('out', {
      ...billOccurrence,
      occurrenceId: 'bill:7:2026-04-17',
      scheduledDate: '2026-04-17'
    }, 12, storage),
    /already linked/
  )
})

test('occurrence edits update the same linked transaction only after explicit confirmation and preserve account isolation', () => {
  const storage = createStorage()
  seedAccounts(storage)
  const { transaction } = createOccurrenceTransaction('in', incomeOccurrence, '2026-04-11', storage)

  updateOccurrenceTransaction(transaction.id, {
    name: 'Corrected paycheck',
    amount: 1150,
    date: '2026-04-12',
    accountId: 2
  }, storage)
  const data = loadSavedAccountData(storage)
  assert.equal(data.transactions.length, 1)
  assert.equal(data.transactions[0].id, transaction.id)
  assert.equal(data.transactions[0].accountId, 2)
  assert.equal(data.transactions[0].amount, 1150)
  assert.equal(calculateAccountBalances(1000, data.transactions.filter(item => item.accountId === 1)).available, 1000)
  assert.equal(calculateAccountBalances(500, data.transactions.filter(item => item.accountId === 2)).available, 1650)
})

test('unlink retains the account transaction; reversing it removes the transaction and resets the occurrence', () => {
  const storage = createStorage()
  seedAccounts(storage)
  const bill = {
    id: 7,
    name: 'Electric',
    amount: 80,
    dueDate: '2026-04-10',
    frequency: 'one-time',
    accountId: 1,
    paymentHistory: []
  }
  const { transaction } = createOccurrenceTransaction('out', billOccurrence, '2026-04-10', storage)
  const billWithHistory = {
    ...bill,
    paymentHistory: [{ dueDate: '2026-04-10', transactionId: transaction.id, paid: true }]
  }

  unlinkOccurrenceTransaction(transaction.id, storage)
  let data = loadSavedAccountData(storage)
  assert.equal(data.transactions.length, 1)
  assert.equal(data.transactions[0].linkedOccurrenceId, undefined)
  assert.equal(getBillOccurrences([billWithHistory], new Date(Date.UTC(2026, 3, 1)), data.transactions)[0].paid, false)

  const relinked = linkExistingOccurrenceTransaction('out', billOccurrence, transaction.id, storage)
  assert.equal(relinked.linkedOccurrenceId, billOccurrence.occurrenceId)
  data = loadSavedAccountData(storage)
  assert.equal(getBillOccurrences([billWithHistory], new Date(Date.UTC(2026, 3, 1)), data.transactions)[0].paid, true)
  saveAccountData(data.accounts, data.transactions.filter(item => item.id !== transaction.id), storage)
  assert.equal(getBillOccurrences([billWithHistory], new Date(Date.UTC(2026, 3, 1)), loadSavedAccountData(storage).transactions)[0].paid, false)
})

test('separate recurring occurrences on the same schedule link to different transactions', () => {
  const storage = createStorage()
  seedAccounts(storage)
  const schedule = {
    id: 7,
    name: 'Weekly bill',
    amount: 25,
    dueDate: '2026-04-03',
    frequency: 'weekly',
    accountId: 1,
    paymentHistory: []
  }
  const occurrences = getBillOccurrences(
    [schedule],
    new Date(Date.UTC(2026, 3, 1))
  )
  const first = createOccurrenceTransaction('out', occurrences[0], occurrences[0].dueDate, storage)
  const second = createOccurrenceTransaction('out', occurrences[1], occurrences[1].dueDate, storage)
  const transactions = loadSavedAccountData(storage).transactions

  assert.notEqual(first.transaction.id, second.transaction.id)
  assert.notEqual(first.transaction.linkedOccurrenceId, second.transaction.linkedOccurrenceId)
  assert.equal(transactions.length, 2)
  assert.deepEqual(transactions.map(item => item.linkedOccurrenceId), [
    'bill:7:2026-04-03',
    'bill:7:2026-04-10'
  ])

  setOccurrenceTransactionCleared(first.transaction.id, true, storage)
  const summary = getPaydayBillSummary([schedule], {
    startDate: '2026-04-01',
    endDate: '2026-04-30'
  }, loadSavedAccountData(storage).transactions)
  assert.deepEqual({
    totalDue: summary.totalDue,
    cleared: summary.cleared,
    remaining: summary.remaining,
    clearedCount: summary.clearedCount,
    totalCount: summary.totalCount
  }, {
    totalDue: 100,
    cleared: 25,
    remaining: 75,
    clearedCount: 1,
    totalCount: 4
  })
})

test('a linked transaction edited to a mismatched account or amount requires review and is not reported as cleared or received', () => {
  const storage = createStorage()
  seedAccounts(storage)
  const bill = {
    id: 7,
    name: 'Electric',
    amount: 80,
    dueDate: '2026-04-10',
    frequency: 'one-time',
    accountId: 1,
    paymentHistory: []
  }
  const income = {
    id: 3,
    name: 'Paycheck',
    amount: 1200,
    dueDate: '2026-04-10',
    frequency: 'one-time',
    accountId: 1,
    paymentHistory: []
  }
  const billTx = createOccurrenceTransaction('out', billOccurrence, '2026-04-10', storage).transaction
  const incomeTx = createOccurrenceTransaction('in', incomeOccurrence, '2026-04-10', storage).transaction
  setOccurrenceTransactionCleared(billTx.id, true, storage)
  updateOccurrenceTransaction(billTx.id, { amount: -70 }, storage)
  updateOccurrenceTransaction(incomeTx.id, { amount: 1100 }, storage)
  const transactions = loadSavedAccountData(storage).transactions
  const billOccurrenceData = getBillOccurrences([bill], new Date(Date.UTC(2026, 3, 1)), transactions)[0]
  const incomeOccurrenceData = getIncomeOccurrences([income], new Date(Date.UTC(2026, 3, 1)), transactions)[0]

  assert.equal(getPaydayBillSummary([bill], {
    startDate: '2026-04-01',
    endDate: '2026-04-30'
  }, transactions).cleared, 0)
  assert.equal(getPaydayBillSummary([bill], {
    startDate: '2026-04-01',
    endDate: '2026-04-30'
  }, transactions).remaining, 80)
  assert.equal(billOccurrenceData.linkedTransaction.id, billTx.id)
  assert.equal(incomeOccurrenceData.linkedTransaction.id, incomeTx.id)
  assert.equal(incomeOccurrenceData.status, 'received')
  assert.equal(incomeOccurrenceData.amount, 1200)
  assert.equal(getIncomeSummary([incomeOccurrenceData]).received, 0)
})
