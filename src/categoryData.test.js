import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCategories,
  loadCategoryConfig,
  loadCategories,
  saveCategoryConfig,
  saveCategories,
  suggestTransactionCategory
} from './categoryData.js'

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
  assert.equal(getCategories(config.customCategories, 'expense', config.builtInNames)[0], 'Food at Home')
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
