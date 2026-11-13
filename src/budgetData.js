import { classifyTransactions, getSpendingEntries, netSpending } from './transactionRules.js'

export const BUDGET_STORAGE_KEY = 'money-honey-budgets'
export const MANUAL_BUDGET_STORAGE_KEY = 'money-honey-manual-budgets'
export const SMART_BUDGET_STORAGE_KEY = 'money-honey-smart-budgets'
export const SMART_DISMISSED_STORAGE_KEY = 'money-honey-smart-dismissed'
export const BUDGET_MODE_STORAGE_KEY = 'money-honey-budget-mode'
export const BUDGET_SETTINGS_STORAGE_KEY = 'money-honey-budget-settings'

function dispatchBudgetUpdate(eventName) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(eventName))
  }
}

function readBudgets(key, storage) {
  const saved = storage.getItem(key)
  if (saved === null) return {}
  let data
  try {
    data = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved Money Honey budgets could not be read.', { cause: error })
  }

  if (!data || typeof data.budgets !== 'object' || Array.isArray(data.budgets)) {
    throw new Error('Saved Money Honey budgets are invalid.')
  }
  return data.budgets
}

export function loadBudgets(modeOrStorage = 'manual', maybeStorage = localStorage) {
  const isStorage = typeof modeOrStorage === 'object'
  const mode = isStorage ? 'manual' : modeOrStorage
  const storage = isStorage ? modeOrStorage : maybeStorage
  const key = mode === 'smart' ? SMART_BUDGET_STORAGE_KEY : MANUAL_BUDGET_STORAGE_KEY
  const modeBudgets = storage.getItem(key)
  if (modeBudgets !== null) return readBudgets(key, storage)

  // Existing versions stored all budgets in this key. Treat them as manual
  // budgets so changing modes never loses values.
  if (mode !== 'manual') return {}
  const legacyBudgets = readBudgets(BUDGET_STORAGE_KEY, storage)
  if (storage.getItem(MANUAL_BUDGET_STORAGE_KEY) === null) {
    storage.setItem(MANUAL_BUDGET_STORAGE_KEY, JSON.stringify({ budgets: legacyBudgets }))
  }
  return legacyBudgets
}

export function saveBudgets(budgets, modeOrStorage = 'manual', maybeStorage = localStorage) {
  const isStorage = typeof modeOrStorage === 'object'
  const mode = isStorage ? 'manual' : modeOrStorage
  const storage = isStorage ? modeOrStorage : maybeStorage
  const key = mode === 'smart' ? SMART_BUDGET_STORAGE_KEY : MANUAL_BUDGET_STORAGE_KEY
  const validBudgets = Object.fromEntries(
    Object.entries(budgets).filter(([, amount]) =>
      Number.isFinite(Number(amount)) && Number(amount) >= 0
    ).map(([category, amount]) => [category, Number(amount)])
  )
  storage.setItem(key, JSON.stringify({ budgets: validBudgets }))
  if (typeof window !== 'undefined' && storage === window.localStorage) dispatchBudgetUpdate('money-honey-budgets-updated')
  return validBudgets
}

export function loadBudgetMode(storage = localStorage) {
  const mode = storage.getItem(BUDGET_MODE_STORAGE_KEY)
  return mode === 'smart' ? 'smart' : 'manual'
}

export function saveBudgetMode(mode, storage = localStorage) {
  const nextMode = mode === 'smart' ? 'smart' : 'manual'
  storage.setItem(BUDGET_MODE_STORAGE_KEY, nextMode)
  return nextMode
}

const defaultBudgetSettings = {
  mode: 'manual',
  period: 'monthly',
  historyMonths: 3,
  suggestionsEnabled: false,
  rolloverEnabled: false
}

export function loadBudgetSettings(storage = localStorage) {
  const saved = storage.getItem(BUDGET_SETTINGS_STORAGE_KEY)
  if (saved === null) {
    return {
      ...defaultBudgetSettings,
      mode: loadBudgetMode(storage)
    }
  }
  let settings
  try {
    settings = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved Money Honey budget settings could not be read.', { cause: error })
  }
  if (!settings || typeof settings !== 'object') {
    throw new Error('Saved Money Honey budget settings are invalid.')
  }
  return {
    ...defaultBudgetSettings,
    ...settings,
    mode: settings.mode === 'smart' ? 'smart' : 'manual',
    period: settings.period === 'paycheck' ? 'paycheck' : 'monthly',
    historyMonths: [3, 6, 12].includes(Number(settings.historyMonths))
      ? Number(settings.historyMonths)
      : 3,
    suggestionsEnabled: settings.suggestionsEnabled === true,
    rolloverEnabled: settings.rolloverEnabled === true
  }
}

export function saveBudgetSettings(settings, storage = localStorage) {
  const next = {
    ...defaultBudgetSettings,
    ...settings,
    mode: settings.mode === 'smart' ? 'smart' : 'manual',
    period: settings.period === 'paycheck' ? 'paycheck' : 'monthly',
    historyMonths: [3, 6, 12].includes(Number(settings.historyMonths))
      ? Number(settings.historyMonths)
      : 3,
    suggestionsEnabled: settings.suggestionsEnabled === true,
    rolloverEnabled: settings.rolloverEnabled === true
  }
  storage.setItem(BUDGET_SETTINGS_STORAGE_KEY, JSON.stringify(next))
  storage.setItem(BUDGET_MODE_STORAGE_KEY, next.mode)
  if (typeof window !== 'undefined' && storage === window.localStorage) dispatchBudgetUpdate('money-honey-budget-settings-updated')
  return next
}

function readObject(key, storage) {
  const saved = storage.getItem(key)
  if (saved === null) return {}
  let value
  try {
    value = JSON.parse(saved)
  } catch (error) {
    throw new Error(`Saved Money Honey data for ${key} could not be read.`, { cause: error })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Saved Money Honey data for ${key} is invalid.`)
  }
  return value
}

export function loadDismissedSmartSuggestions(storage = localStorage) {
  return readObject(SMART_DISMISSED_STORAGE_KEY, storage)
}

export function saveDismissedSmartSuggestion(category, signature, storage = localStorage) {
  const dismissed = loadDismissedSmartSuggestions(storage)
  dismissed[category] = signature
  storage.setItem(SMART_DISMISSED_STORAGE_KEY, JSON.stringify(dismissed))
  if (typeof window !== 'undefined' && storage === window.localStorage) dispatchBudgetUpdate('money-honey-budgets-updated')
  return dismissed
}

export function getCompleteBudgetMonths(today, count) {
  const monthCount = [3, 6, 12].includes(Number(count)) ? Number(count) : 3
  const firstDayOfCurrentMonth = new Date(`${today}T12:00:00Z`)
  firstDayOfCurrentMonth.setUTCDate(1)
  return Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(firstDayOfCurrentMonth)
    date.setUTCMonth(date.getUTCMonth() - (monthCount - index))
    return date.toISOString().slice(0, 7)
  })
}

// Purchases (+) and refunds (-) by category, from the shared classification rules in transactionRules.js.
// Budgets, Daily Spending, and Reports all read spending through this, so they always agree.
export function getBudgetSpendingEntries({ transactions, categories }) {
  return getSpendingEntries(classifyTransactions({ transactions, categories }))
}

export function analyzeSmartBudgets({ transactions, today, categories, historyMonths }) {
  const months = getCompleteBudgetMonths(today, historyMonths)
  const totals = Object.fromEntries(categories.map(category => [category, 0]))
  const entries = getBudgetSpendingEntries({ transactions, categories })
  for (const month of months) {
    const { byCategory } = netSpending(entries.filter(entry => entry.date?.slice(0, 7) === month))
    for (const [category, cents] of Object.entries(byCategory)) {
      if (category in totals) totals[category] += cents / 100
    }
  }
  return {
    months,
    startMonth: months[0],
    endMonth: months[months.length - 1],
    categories: categories.map(category => {
      const total = totals[category]
      const average = total / months.length
      const hasEnoughHistory = total > 0
      return {
        category,
        total,
        average,
        hasEnoughHistory,
        suggestedBudget: hasEnoughHistory ? Math.ceil(average / 10) * 10 : null,
        signature: `${months.join(',')}|${average.toFixed(2)}`
      }
    })
  }
}

export function calculateBudgetSnapshot({ transactions, today, categories, mode, budgets }) {
  const budgetTotal = categories.reduce((total, category) => {
    const amount = Number(budgets[category])
    return Number.isFinite(amount) && amount >= 0 ? total + amount : total
  }, 0)
  const spendingByCategory = getBudgetSpendingByCategory({ transactions, today, categories })
  const actualSpending = Object.values(spendingByCategory).reduce((total, amount) => total + amount, 0)

  return {
    mode,
    budgetTotal,
    actualSpending,
    remaining: Math.max(0, budgetTotal - actualSpending),
    progress: budgetTotal > 0 ? Math.min(100, (actualSpending / budgetTotal) * 100) : 0,
    hasBudgets: budgetTotal > 0 || Object.keys(budgets).length > 0
  }
}

export function getBudgetSpendingByCategory({ transactions, today, categories }) {
  const month = today.slice(0, 7)
  const { byCategory } = netSpending(
    getBudgetSpendingEntries({ transactions, categories }).filter(entry => entry.date?.slice(0, 7) === month)
  )
  return Object.fromEntries(Object.entries(byCategory).map(([category, cents]) => [category, cents / 100]))
}
