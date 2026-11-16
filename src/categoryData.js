export const CATEGORY_STORAGE_KEY = 'money-honey-categories'
export const CATEGORY_STORAGE_VERSION = 1

export const EXPENSE_CATEGORIES = [
  'Groceries',
  'Eating Out',
  'Entertainment',
  'Shopping',
  'Gas & Fuel',
  'Household',
  'Housing & Utilities',
  'Personal Care',
  'Pets',
  'Subscriptions',
  'Transportation',
  'Healthcare',
  'Debt Payments',
  'Other'
]

export const INCOME_CATEGORIES = [
  'Paycheck',
  'Child Support',
  'Commission',
  'Other Income'
]

const BUILT_IN_IDS = [
  ...EXPENSE_CATEGORIES.map(name => `expense:${name}`),
  ...INCOME_CATEGORIES.map(name => `income:${name}`)
]

function normalizeName(name) {
  return String(name ?? '').trim().toLocaleLowerCase()
}

function normalizeCustomCategory(category) {
  if (!category || typeof category.name !== 'string' || !category.name.trim()) return null
  return {
    name: category.name.trim(),
    type: category.type === 'income' ? 'income' : 'expense'
  }
}

export function loadCategories(storage = localStorage) {
  return loadCategoryConfig(storage).customCategories
}

export function loadCategoryConfig(storage = localStorage) {
  const saved = storage.getItem(CATEGORY_STORAGE_KEY)
  if (saved === null) return { customCategories: [], builtInNames: {}, disabledBuiltIns: [], deletedCategories: [], legacyCategoryTypes: {} }

  let data
  try {
    data = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved Money Honey categories could not be read.', { cause: error })
  }
  if (!data || !Array.isArray(data.customCategories)
    || (data.deletedCategories !== undefined && !Array.isArray(data.deletedCategories))
    || (data.legacyCategoryTypes !== undefined && (!data.legacyCategoryTypes || typeof data.legacyCategoryTypes !== 'object' || Array.isArray(data.legacyCategoryTypes)))) {
    throw new Error('Saved Money Honey categories are invalid.')
  }
  const builtInNames = Object.fromEntries(
    Object.entries(data.builtInNames ?? {}).filter(([id, name]) =>
      BUILT_IN_IDS.includes(id) && typeof name === 'string' && name.trim()
    )
  )
  return {
    customCategories: data.customCategories.map(normalizeCustomCategory).filter(Boolean),
    builtInNames,
    disabledBuiltIns: (data.disabledBuiltIns ?? []).filter(id => BUILT_IN_IDS.includes(id)),
    deletedCategories: (data.deletedCategories ?? []).map(normalizeCustomCategory).filter(Boolean),
    legacyCategoryTypes: Object.fromEntries(Object.entries(data.legacyCategoryTypes ?? {})
      .filter(([, type]) => type === 'income' || type === 'expense'))
  }
}

export function saveCategories(customCategories, storage = localStorage) {
  return saveCategoryConfig({ customCategories }, storage).customCategories
}

export function saveCategoryConfig(config, storage = localStorage) {
  const previous = loadCategoryConfig(storage)
  const next = { ...previous, ...config }
  next.customCategories = next.customCategories.map(normalizeCustomCategory)
  if (next.customCategories.some(category => !category)) throw new Error('Enter a category name.')
  for (const type of ['expense', 'income']) {
    const previousCounts = new Map()
    for (const name of getCategories(previous.customCategories, type, previous.builtInNames, previous.disabledBuiltIns)) {
      const key = normalizeName(name)
      previousCounts.set(key, (previousCounts.get(key) ?? 0) + 1)
    }
    const counts = new Map()
    for (const name of getCategories(next.customCategories, type, next.builtInNames, next.disabledBuiltIns)) {
      const key = normalizeName(name)
      const count = (counts.get(key) ?? 0) + 1
      if (count > 1 && count > (previousCounts.get(key) ?? 0)) throw new Error(`An ${type} category named "${name}" already exists.`)
      counts.set(key, count)
    }
  }
  // Keep old money-in records classified the same way when the other category type gains the same name.
  const legacyTypes = new Map(Object.entries({ ...previous.legacyCategoryTypes, ...next.legacyCategoryTypes }))
  const previousExpenses = new Set(getHistoricalCategories(previous, 'expense').map(normalizeName))
  const previousIncomes = new Set(getHistoricalCategories(previous, 'income').map(normalizeName))
  const incomes = new Set(getHistoricalCategories(next, 'income').map(normalizeName))
  for (const name of getHistoricalCategories(next, 'expense')) {
    const key = normalizeName(name)
    if (incomes.has(key) && !legacyTypes.has(key)) {
      legacyTypes.set(key, previousIncomes.has(key) && !previousExpenses.has(key) ? 'income' : 'expense')
    }
  }
  next.legacyCategoryTypes = Object.fromEntries(legacyTypes)
  try {
    storage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify({ version: CATEGORY_STORAGE_VERSION, ...next }))
  } catch (error) {
    throw new Error('Could not save categories. Device storage may be full or unavailable. Your changes were not saved.', { cause: error })
  }
  return next
}

export function getCategories(customCategories, kind, builtInNames = {}, disabledBuiltIns = []) {
  const defaults = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const displayedDefaults = defaults
    .filter(name => !disabledBuiltIns.includes(`${kind}:${name}`))
    .map(name => builtInNames[`${kind}:${name}`] ?? name)
  return [...displayedDefaults, ...customCategories
    .filter(category => category.type === kind)
    .map(category => category.name)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export function getHistoricalCategories(config, kind = 'expense') {
  return [...new Set([
    ...getCategories(config.customCategories, kind, config.builtInNames),
    ...(config.deletedCategories ?? []).filter(category => category.type === kind).map(category => category.name)
  ])]
}

export function getTransactionCategoryType(transaction, config) {
  if (transaction.categoryType === 'income' || transaction.categoryType === 'expense') return transaction.categoryType
  if (transaction.amount < 0) return 'expense'
  const key = normalizeName(transaction.category)
  if (Object.hasOwn(config.legacyCategoryTypes ?? {}, key)) return config.legacyCategoryTypes[key]
  return getHistoricalCategories(config).includes(transaction.category) ? 'expense' : 'income'
}

export function getReportingTransactions(transactions, config) {
  return transactions.map(transaction => {
    const key = normalizeName(transaction.category)
    return transaction.amount > 0 && !transaction.categoryType && Object.hasOwn(config.legacyCategoryTypes ?? {}, key)
      ? { ...transaction, categoryType: config.legacyCategoryTypes[key] }
      : transaction
  })
}

export function getCategoryId(name, kind, builtInNames = {}, disabledBuiltIns = []) {
  const defaults = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const index = defaults.findIndex(defaultName =>
    !disabledBuiltIns.includes(`${kind}:${defaultName}`) && (builtInNames[`${kind}:${defaultName}`] ?? defaultName) === name
  )
  return index === -1 ? null : `${kind}:${defaults[index]}`
}

export function getDefaultCategoryForFlow(flow, config) {
  const name = flow === 'in' ? 'Other Income' : 'Other'
  return !config || getCategories(config.customCategories, flow === 'in' ? 'income' : 'expense', config.builtInNames, config.disabledBuiltIns).includes(name) ? name : ''
}

export function isActiveCategory(name, kind, config) {
  return Boolean(name) && getCategories(config.customCategories, kind, config.builtInNames, config.disabledBuiltIns).includes(name)
}

// Category fields for a transaction created or linked from a bill (flow 'out') or income (flow 'in').
// A deleted category is never applied to new transactions; uncategorized schedules keep the old default.
export function getScheduleTransactionCategoryFields(flow, category, storage = localStorage) {
  const kind = flow === 'in' ? 'income' : 'expense'
  let config = null
  try {
    config = loadCategoryConfig(storage)
  } catch {
    config = null
  }
  if (category && (!config || isActiveCategory(category, kind, config))) return { category, categoryType: kind }
  return null
}

export function suggestTransactionCategory(transactions, name, kind, customCategories = [], builtInNames = {}, disabledBuiltIns = []) {
  const normalizedName = normalizeName(name)
  if (!normalizedName) return ''
  const valid = new Set(getCategories(customCategories, kind, builtInNames, disabledBuiltIns))
  const match = [...transactions].reverse().find(transaction =>
    normalizeName(transaction.name) === normalizedName
      && (transaction.categoryType ?? (transaction.amount < 0 ? 'expense' : 'income')) === kind
      && valid.has(transaction.category)
  )
  return match?.category ?? ''
}

export function renameCategory(customCategories, oldName, newName, type) {
  return customCategories.map(category =>
    category.type === type && normalizeName(category.name) === normalizeName(oldName)
      ? { ...category, name: newName.trim() }
      : category
  )
}
