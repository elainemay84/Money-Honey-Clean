import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CATEGORY_STORAGE_KEY,
  getCategories,
  getCategoryId,
  getDefaultCategoryForFlow,
  getHistoricalCategories,
  getReportingTransactions,
  loadCategoryConfig,
  loadCategories,
  saveCategoryConfig,
  saveCategories,
  renameCategory,
  suggestTransactionCategory
} from './categoryData.js'
import { getIncomeVsExpenses, getSpendingByCategory } from './reportData.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
}

test('custom categories are created and persist after reload', () => {
  const storage = createStorage()
  const saved = saveCategories([{ name: 'Coffee Runs', type: 'expense' }], storage)

  assert.deepEqual(saved, [{ name: 'Coffee Runs', type: 'expense' }])
  assert.deepEqual(loadCategories(storage), saved)
  assert.ok(getCategories(saved, 'expense').includes('Coffee Runs'))
})

test('merchant suggestions use a previous categorized transaction without guessing', () => {
  const transactions = [
    { name: 'Walmart', amount: -42, category: 'Groceries' },
    { name: 'Netflix', amount: -18, category: 'Subscriptions' }
  ]

  assert.equal(suggestTransactionCategory(transactions, 'walmart', 'expense'), 'Groceries')
  assert.equal(suggestTransactionCategory(transactions, 'Unknown Merchant', 'expense'), '')
  assert.equal(suggestTransactionCategory(transactions, 'Walmart', 'income'), '')
})

test('built-in display names persist separately from their stable category ids', () => {
  const storage = createStorage()
  saveCategoryConfig({
    customCategories: [],
    builtInNames: { 'expense:Groceries': 'Food at Home' }
  }, storage)

  const config = loadCategoryConfig(storage)
  assert.equal(config.builtInNames['expense:Groceries'], 'Food at Home')
  assert.ok(getCategories(config.customCategories, 'expense', config.builtInNames).includes('Food at Home'))
  assert.deepEqual(loadCategories(storage), [])
})

test('deleted category configuration persists its disabled id and keeps other categories', () => {
  const storage = createStorage()
  saveCategoryConfig({
    customCategories: [{ name: 'Coffee Runs', type: 'expense' }],
    builtInNames: {},
    disabledBuiltIns: ['expense:Other']
  }, storage)

  const config = loadCategoryConfig(storage)
  assert.deepEqual(config.disabledBuiltIns, ['expense:Other'])
  assert.ok(getCategories(config.customCategories, 'expense', config.builtInNames, config.disabledBuiltIns).includes('Coffee Runs'))
  assert.equal(getCategories(config.customCategories, 'expense', config.builtInNames, config.disabledBuiltIns).includes('Other'), false)
})

test('category saves retain deleted presets and renames across later additions and reloads', () => {
  const storage = createStorage()
  saveCategoryConfig({
    customCategories: [],
    builtInNames: { 'expense:Groceries': 'Food at Home' },
    disabledBuiltIns: ['expense:Other', 'income:Other Income']
  }, storage)
  saveCategories([{ name: 'Coffee', type: 'expense' }], storage)
  for (let i = 0; i < 3; i++) {
    const config = loadCategoryConfig(storage)
    assert.equal(getCategories(config.customCategories, 'expense', config.builtInNames, config.disabledBuiltIns).includes('Other'), false)
    assert.equal(getDefaultCategoryForFlow('out', config), '')
    assert.equal(getDefaultCategoryForFlow('in', config), '')
    assert.equal(config.builtInNames['expense:Groceries'], 'Food at Home')
    saveCategoryConfig({ customCategories: config.customCategories }, storage)
  }
})

test('large category catalogs retain both types, spelling and case-insensitive alphabetical choices', () => {
  const storage = createStorage()
  const categories = Array.from({ length: 1500 }, (_, i) => ({ name: `Category ${i}`, type: i % 2 ? 'income' : 'expense' }))
  categories.push(
    { name: 'zebra', type: 'expense' }, { name: 'ALPHA', type: 'expense' },
    { name: 'zebra', type: 'income' }, { name: 'Paycheck', type: 'expense' },
    { name: 'Groceries', type: 'income' }
  )
  saveCategories(categories, storage)
  assert.deepEqual(loadCategories(storage), categories)
  for (const type of ['expense', 'income']) {
    const choices = getCategories(loadCategories(storage), type)
    assert.deepEqual(choices, [...choices].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })))
    assert.ok(choices.includes('zebra'))
  }
})

test('same-type duplicates and blank names fail explicitly without replacing saved categories', () => {
  const storage = createStorage()
  const original = [{ name: 'Coffee', type: 'expense' }]
  saveCategories(original, storage)
  for (const name of ['COFFEE', 'coffee', ' groceries ', '']) {
    assert.throws(() => saveCategories([...original, { name, type: 'expense' }], storage), /already exists|Enter a category name/)
    assert.deepEqual(loadCategories(storage), original)
  }
})

test('pre-existing duplicate names do not block unrelated additions or erase legacy entries', () => {
  const storage = createStorage()
  const customCategories = [{ name: 'Coffee', type: 'expense' }, { name: 'coffee', type: 'expense' }]
  storage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify({ version: 1, customCategories }))
  saveCategories([...customCategories, { name: 'New category', type: 'expense' }], storage)
  assert.deepEqual(loadCategories(storage).slice(0, 2), customCategories)
  assert.equal(loadCategories(storage).length, 3)
})

test('deleted or renamed preset names can be reused without silently dropping the custom category', () => {
  const storage = createStorage()
  const config = saveCategoryConfig({
    customCategories: [],
    builtInNames: { 'expense:Groceries': 'Food' },
    disabledBuiltIns: ['expense:Other']
  }, storage)
  saveCategories([{ name: 'Groceries', type: 'expense' }, { name: 'Other', type: 'expense' }], storage)
  assert.equal(loadCategories(storage).length, 2)
  assert.deepEqual(loadCategoryConfig(storage).disabledBuiltIns, config.disabledBuiltIns)
  assert.equal(getCategoryId('Food', 'expense', { 'expense:Groceries': 'Food', 'expense:Eating Out': 'Food' }, ['expense:Groceries']), 'expense:Eating Out')
})

test('custom rename stays within its type and rejects collisions without losing existing entries', () => {
  const storage = createStorage()
  const custom = [{ name: 'Coffee', type: 'expense' }, { name: 'Coffee', type: 'income' }]
  saveCategories(custom, storage)
  const renamed = renameCategory(custom, 'Coffee', 'Cafe', 'expense')
  saveCategories(renamed, storage)
  assert.deepEqual(loadCategories(storage), [{ name: 'Cafe', type: 'expense' }, { name: 'Coffee', type: 'income' }])
  assert.throws(() => saveCategories(renameCategory(renamed, 'Cafe', 'Groceries', 'expense'), storage), /already exists/)
  assert.deepEqual(loadCategories(storage), renamed)
})

test('deletion preserves historical categories, refund totals and raw financial records', () => {
  const storage = createStorage()
  const config = saveCategoryConfig({
    customCategories: [],
    disabledBuiltIns: ['expense:Groceries'],
    deletedCategories: [{ name: 'Coffee', type: 'expense' }]
  }, storage)
  const transactions = [
    { id: 1, category: 'Groceries', amount: -50, date: '2026-11-01' },
    { id: 2, category: 'Groceries', amount: 10, date: '2026-11-02' },
    { id: 3, category: 'Coffee', amount: -15, date: '2026-11-02' }
  ]
  const before = structuredClone(transactions)
  const report = getSpendingByCategory({ transactions, month: '2026-11', categories: getHistoricalCategories(config) })
  assert.equal(report.total, 55)
  assert.deepEqual(report.items.map(item => [item.category, item.amount]), [['Groceries', 40], ['Coffee', 15]])
  assert.deepEqual(transactions, before)
})

test('same-named income and expense categories do not reinterpret existing income or refunds', () => {
  const storage = createStorage()
  const transactions = [
    { id: 1, category: 'Paycheck', amount: 1000, date: '2026-11-01' },
    { id: 2, category: 'Groceries', amount: -50, date: '2026-11-01' },
    { id: 3, category: 'Groceries', amount: 10, date: '2026-11-02' }
  ]
  const before = structuredClone(transactions)
  saveCategories([{ name: 'Paycheck', type: 'expense' }, { name: 'Groceries', type: 'income' }], storage)
  const config = loadCategoryConfig(storage)
  const result = getIncomeVsExpenses({
    transactions: getReportingTransactions(transactions, config), month: '2026-11', categories: getHistoricalCategories(config)
  })
  assert.equal(result.income, 1000)
  assert.equal(result.expenses, 40)
  assert.equal(result.refundTotal, 10)
  assert.deepEqual(transactions, before)
})

test('real storage failures are reported without claiming categories were saved', () => {
  assert.throws(() => saveCategories([{ name: 'Coffee', type: 'expense' }], {
    getItem: () => null,
    setItem: () => { throw new DOMException('Full', 'QuotaExceededError') }
  }), /storage may be full or unavailable.*not saved/)
})
