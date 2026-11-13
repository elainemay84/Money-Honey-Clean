import assert from 'node:assert/strict'
import test from 'node:test'
import {
  UNCATEGORIZED,
  classifyTransactions,
  getClassificationFlags,
  getSpendingEntries,
  isDebtPaymentTransaction,
  isTransferTransaction,
  netSpending
} from './transactionRules.js'

const categories = ['Groceries', 'Shopping', 'Debt Payments', 'Other']
let nextId = 1
const txn = (amount, extra = {}) => ({ id: nextId++, accountId: 1, name: 'Item', amount, date: '2026-11-10', cleared: true, category: 'Groceries', ...extra })
const classify = (transactions, accounts = []) => classifyTransactions({ transactions, categories, accounts })
const kinds = (transactions, accounts) => classify(transactions, accounts).map(record => record.kind)

test('every transaction gets exactly one kind', () => {
  assert.deepEqual(kinds([
    txn(-10),
    txn(25),
    txn(500, { category: 'Paycheck' }),
    txn(-50, { type: 'transfer' }),
    txn(-50, { transactionType: 'debt-payment' }),
    txn(0),
    txn('oops')
  ]), ['purchase', 'refund', 'income', 'transfer', 'debt-payment', 'ignored', 'ignored'])
})

test('transfers are recognized by metadata first and by the existing name rule', () => {
  for (const extra of [{ type: 'transfer' }, { isTransfer: true }, { transferId: 'x' }, { name: 'Transfer to Savings' }, { name: 'Payment to Credit Card' }, { name: 'payment to debt' }]) {
    assert.equal(isTransferTransaction(txn(-5, extra)), true, JSON.stringify(extra))
  }
  assert.equal(isTransferTransaction(txn(-5, { name: 'Wire fee for transfer' })), false)
})

test('debt payments are recognized by reliable debt metadata, whatever their category or name', () => {
  for (const extra of [
    { transactionType: 'debt-payment' },
    { linkedDebtId: 3 },
    { linkedDebtPaymentId: 'p9' },
    { category: 'Debt Payments' },
    { category: 'Groceries', name: 'Totally ordinary name', linkedDebtId: 0 }
  ]) {
    assert.equal(isDebtPaymentTransaction(txn(-90, extra)), true, JSON.stringify(extra))
  }
  assert.equal(isDebtPaymentTransaction(txn(-90, { name: 'Debt payment · looks like one' })), false)
  assert.equal(classify([txn(-214, { category: 'Housing', linkedDebtId: 7 })])[0].kind, 'debt-payment')
})

test('an existing expense later linked to a debt stops counting as spending', () => {
  const unlinked = txn(-214, { category: 'Shopping' })
  assert.equal(classify([unlinked])[0].kind, 'purchase')
  assert.equal(classify([{ ...unlinked, linkedDebtId: 1, linkedDebtPaymentId: 'p1', transactionType: 'debt-payment' }])[0].kind, 'debt-payment')
})

test('purchases without a usable category are counted as Uncategorized and flagged, never dropped', () => {
  const [missing, blank, unknown, income] = classify([
    txn(-12, { category: undefined }),
    txn(-8, { category: '   ' }),
    txn(-5, { category: 'Deleted Category' }),
    txn(-3, { category: 'Paycheck' })
  ])
  for (const record of [missing, blank, unknown, income]) {
    assert.equal(record.kind, 'purchase')
    assert.equal(record.category, UNCATEGORIZED)
  }
  assert.deepEqual(missing.flags, ['uncategorized'])
  assert.deepEqual(blank.flags, ['uncategorized'])
  assert.deepEqual(unknown.flags, ['unknown-category'])
  assert.equal(netSpending(getSpendingEntries([missing, blank, unknown, income])).byCategory[UNCATEGORIZED], 28 * 100)
})

test('a credit in an expense category is a refund of that category, not income', () => {
  const [refund] = classify([txn(40, { category: 'Shopping' })])
  assert.equal(refund.kind, 'refund')
  assert.equal(refund.category, 'Shopping')
  assert.deepEqual(refund.flags, [])
})

test('credits elsewhere are income, and ambiguous ones are flagged without changing the count', () => {
  const [plain, noCategory, namedRefund] = classify([
    txn(1500, { category: 'Paycheck', name: 'Pay' }),
    txn(20, { category: undefined, name: 'Deposit' }),
    txn(35, { category: 'Other Income', name: 'Refund from store' })
  ])
  assert.deepEqual([plain.kind, noCategory.kind, namedRefund.kind], ['income', 'income', 'income'])
  assert.deepEqual(plain.flags, [])
  assert.deepEqual(noCategory.flags, ['uncategorized-income'])
  assert.deepEqual(namedRefund.flags, ['possible-refund'])
})

test('credits on a credit card account are never counted as income', () => {
  const accounts = [{ id: 1, type: 'Checking' }, { id: 2, type: 'Credit Card' }]
  const [payment, refund, checkingDeposit] = classify([
    txn(500, { accountId: 2, category: 'Paycheck', name: 'Payment received' }),
    txn(30, { accountId: 2, category: 'Shopping' }),
    txn(500, { accountId: 1, category: 'Paycheck' })
  ], accounts)
  assert.equal(payment.kind, 'card-credit')
  assert.deepEqual(payment.flags, ['card-credit'])
  assert.equal(refund.kind, 'refund')
  assert.equal(checkingDeposit.kind, 'income')
})

test('purchases that look like card payments but carry no debt metadata are flagged and still counted', () => {
  const [unlinked, linked, ordinary] = classify([
    txn(-300, { name: 'Chase Visa payment', category: 'Other' }),
    txn(-300, { name: 'Chase Visa payment', category: 'Other', linkedDebtId: 4 }),
    txn(-30, { name: 'Corner store', category: 'Groceries' })
  ])
  assert.equal(unlinked.kind, 'purchase')
  assert.deepEqual(unlinked.flags, ['possible-card-payment'])
  assert.equal(linked.kind, 'debt-payment')
  assert.deepEqual(ordinary.flags, [])
})

test('duplicate links are counted once on either side and never hide a different link', () => {
  const records = classify([
    txn(-25, { linkedOccurrenceId: 'bill:1:2026-11-04' }),
    txn(-25, { linkedOccurrenceId: 'bill:1:2026-11-04', cleared: false }),
    txn(1500, { category: 'Paycheck', linkedOccurrenceId: 'income:1:2026-11-01' }),
    txn(1500, { category: 'Paycheck', linkedOccurrenceId: 'income:1:2026-11-01' }),
    txn(-25, { linkedOccurrenceId: 'bill:1:2026-12-04' })
  ])
  assert.deepEqual(records.map(record => record.kind), ['purchase', 'duplicate', 'income', 'duplicate', 'purchase'])
})

test('transfers and debt payments do not use up a link, so a real purchase with the same link still counts', () => {
  const records = classify([
    txn(-25, { linkedOccurrenceId: 'bill:9', type: 'transfer' }),
    txn(-25, { linkedOccurrenceId: 'bill:9' })
  ])
  assert.deepEqual(records.map(record => record.kind), ['transfer', 'purchase'])
})

test('refunds reduce their own category, and a refund larger than the spending is reported as unmatched', () => {
  const entries = getSpendingEntries(classify([
    txn(-100, { category: 'Shopping' }),
    txn(30, { category: 'Shopping' }),
    txn(-20, { category: 'Groceries' }),
    txn(50, { category: 'Groceries' })
  ]))
  const result = netSpending(entries)
  assert.deepEqual(result.byCategory, { Shopping: 7000 })
  assert.equal(result.totalCents, 7000)
  assert.equal(result.appliedRefundCents, 5000)
  assert.equal(result.unmatchedRefundCents, 3000)
  assert.deepEqual(result.unmatchedCategories, ['Groceries'])
})

test('flags list each uncertain transaction in the month and change nothing', () => {
  const transactions = [
    txn(-12, { category: undefined, date: '2026-11-03' }),
    txn(50, { category: 'Groceries', date: '2026-11-04' }),
    txn(-300, { name: 'Visa payment', category: 'Other', date: '2026-10-30' })
  ]
  const before = JSON.stringify(transactions)
  const flags = getClassificationFlags(classify(transactions), date => date.startsWith('2026-11'))
  assert.deepEqual(flags.map(flag => flag.reason), ['uncategorized', 'unmatched-refund'])
  assert.equal(JSON.stringify(transactions), before)
})

test('classification never changes the records it reads', () => {
  const transactions = [txn(-10), txn(10), txn(-5, { linkedOccurrenceId: 'a' }), txn(-5, { linkedOccurrenceId: 'a' })]
  const before = JSON.stringify(transactions)
  classify(transactions)
  assert.equal(JSON.stringify(transactions), before)
})
