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
  if (saved === null) return { customCategories: [], builtInNames: {}, disabledBuiltIns: [] }

  let data
  try {
    data = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved Money Honey categories could not be read.', { cause: error })
  }
  if (!data || !Array.isArray(data.customCategories)) {
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
    disabledBuiltIns: (data.disabledBuiltIns ?? []).filter(id => BUILT_IN_IDS.includes(id))
  }
}

export function saveCategories(customCategories, storage = localStorage) {
  return saveCategoryConfig({ customCategories }, storage).customCategories
}

export function saveCategoryConfig({ customCategories, builtInNames = {}, disabledBuiltIns = [] }, storage = localStorage) {
  const unique = []
  const seen = new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].map(normalizeName))
  for (const category of customCategories.map(normalizeCustomCategory).filter(Boolean)) {
    const key = normalizeName(category.name)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(category)
  }
  storage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify({
    version: CATEGORY_STORAGE_VERSION,
    customCategories: unique,
    builtInNames,
    disabledBuiltIns
  }))
  return { customCategories: unique, builtInNames, disabledBuiltIns }
}

export function getCategories(customCategories, kind, builtInNames = {}, disabledBuiltIns = []) {
  const defaults = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const displayedDefaults = defaults
    .filter(name => !disabledBuiltIns.includes(`${kind}:${name}`))
    .map(name => builtInNames[`${kind}:${name}`] ?? name)
  return [...displayedDefaults, ...customCategories
    .filter(category => category.type === kind)
    .map(category => category.name)]
}

export function getCategoryId(name, kind, builtInNames = {}) {
  const defaults = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const index = defaults.findIndex(defaultName =>
    (builtInNames[`${kind}:${defaultName}`] ?? defaultName) === name
  )
  return index === -1 ? null : `${kind}:${defaults[index]}`
}

export function getDefaultCategoryForFlow(flow) {
  return flow === 'in' ? 'Other Income' : 'Other'
}

export function suggestTransactionCategory(transactions, name, kind, customCategories = [], builtInNames = {}, disabledBuiltIns = []) {
  const normalizedName = normalizeName(name)
  if (!normalizedName) return ''
  const valid = new Set(getCategories(customCategories, kind, builtInNames, disabledBuiltIns))
  const match = [...transactions].reverse().find(transaction =>
    normalizeName(transaction.name) === normalizedName
      && (transaction.amount < 0 ? 'expense' : 'income') === kind
      && valid.has(transaction.category)
  )
  return match?.category ?? ''
}

export function renameCategory(customCategories, oldName, newName) {
  return customCategories.map(category =>
    normalizeName(category.name) === normalizeName(oldName)
      ? { ...category, name: newName.trim() }
      : category
  )
}
