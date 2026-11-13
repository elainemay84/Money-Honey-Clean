import { ACCOUNT_STORAGE_KEY, ACCOUNT_STORAGE_VERSION } from './accountStorage.js'
import {
  BILL_STORAGE_KEY,
  BILL_STORAGE_VERSION,
  PAY_SCHEDULE_STORAGE_KEY,
  PAY_SCHEDULE_STORAGE_VERSION
} from './billData.js'
import {
  BUDGET_MODE_STORAGE_KEY,
  BUDGET_SETTINGS_STORAGE_KEY,
  BUDGET_STORAGE_KEY,
  MANUAL_BUDGET_STORAGE_KEY,
  SMART_BUDGET_STORAGE_KEY,
  SMART_DISMISSED_STORAGE_KEY,
  loadBudgetSettings
} from './budgetData.js'
import { CATEGORY_STORAGE_KEY, CATEGORY_STORAGE_VERSION, loadCategoryConfig } from './categoryData.js'
import { DEBT_STORAGE_KEY, DEBT_STORAGE_VERSION } from './debtData.js'
import { APPEARANCE_SIZES, APPEARANCE_SIZE_STORAGE_KEY } from './appearanceData.js'
import { PAYEE_STORAGE_KEY, loadPayees } from './payeeData.js'
import { CUSTOM_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from './themeData.js'

export const TRANSACTION_SORT_STORAGE_KEY = 'money-honey-transaction-sort'

const MAX_DEPTH = 16
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const SENSITIVE_WORDS = new Set([
  'pin', 'pins', 'pwd', 'otp', 'jwt', 'auth', 'authentication', 'authorization', 'passphrase', 'cvv'
])
const SENSITIVE_FRAGMENTS = [
  'password', 'passcode', 'passwd', 'token', 'secret', 'credential', 'apikey', 'privatekey', 'authenticat', 'authoriz'
]

export class BackupImportError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'BackupImportError'
    this.rollbackFailed = options?.rollbackFailed === true
    this.code = options?.code ?? null
  }
}

function fail(message) {
  throw new BackupImportError(message)
}

// Matches field names such as pin, resetPin, user_password, accessToken, or authToken.
export function isSensitiveKey(key) {
  const words = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const compact = words.join('')
  return words.some(word => SENSITIVE_WORDS.has(word))
    || SENSITIVE_FRAGMENTS.some(fragment => compact.includes(fragment))
    || /(?:reset|security|login|user|app|lock|master|access)pin$/.test(compact)
    || /pin(?:code|hash|number|salt|digest)$/.test(compact)
}

function checkKey(key, label, skipSensitive) {
  if (UNSAFE_KEYS.has(key)) fail(`${label} contains an unsafe field name and was rejected.`)
  if (!skipSensitive && isSensitiveKey(key)) {
    fail(
      `${label} contains a "${key.slice(0, 40)}" field. Money Honey never imports PINs, passwords, tokens, or other authentication data, so this file was rejected.`
    )
  }
}

// Deep-copies JSON data, rejecting credential-like or prototype-polluting field names at any depth.
// userKeyed marks an object whose keys are user-entered (such as budget categories).
export function cleanJson(value, label, userKeyed = false, depth = 0) {
  if (depth > MAX_DEPTH) fail(`${label} is nested too deeply.`)
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} contains an invalid number.`)
    return value
  }
  if (Array.isArray(value)) return value.map(item => cleanJson(item, label, false, depth + 1))
  if (typeof value === 'object') {
    const copy = {}
    for (const [key, child] of Object.entries(value)) {
      checkKey(key, label, userKeyed)
      copy[key] = cleanJson(child, label, false, depth + 1)
    }
    return copy
  }
  return fail(`${label} contains an unsupported value.`)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const is = {
  int: value => Number.isInteger(value),
  str: value => typeof value === 'string',
  num: value => typeof value === 'number' && Number.isFinite(value),
  bool: value => typeof value === 'boolean',
  date: value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value),
  array: value => Array.isArray(value),
  objects: value => Array.isArray(value) && value.every(isPlainObject),
  object: isPlainObject
}

function parseObject(raw, label) {
  let value
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new BackupImportError(`${label} is not valid JSON.`, { cause: error })
  }
  if (!isPlainObject(value)) fail(`${label} is not in the expected format.`)
  return value
}

function checkVersion(data, expected, label) {
  if (data.version !== undefined && data.version !== expected) fail(`${label} uses an unsupported version.`)
}

function cleanRecords(list, label, required, optional = {}) {
  if (!Array.isArray(list)) fail(`${label} are not in the expected format.`)
  const ids = new Set()
  return list.map(item => {
    if (!isPlainObject(item)) fail(`${label} contain an invalid record.`)
    const record = cleanJson(item, label)
    for (const [field, check] of Object.entries(required)) {
      if (!check(record[field])) fail(`${label} contain a record with a missing or invalid "${field}".`)
    }
    for (const [field, check] of Object.entries(optional)) {
      if (record[field] != null && !check(record[field])) {
        fail(`${label} contain a record with an invalid "${field}".`)
      }
    }
    if (Object.hasOwn(required, 'id')) {
      if (ids.has(record.id)) fail(`${label} contain a duplicate ID.`)
      ids.add(record.id)
    }
    return record
  })
}

function scratchStorage(key, value) {
  const values = new Map([[key, value]])
  return { getItem: item => values.get(item) ?? null, setItem: (item, text) => values.set(item, text) }
}

function sanitizeBudgets(raw) {
  const data = parseObject(raw, 'Budgets')
  if (!isPlainObject(data.budgets)) fail('Budgets are not in the expected format.')
  const budgets = cleanJson(data.budgets, 'Budgets', true)
  if (Object.values(budgets).some(amount => !is.num(amount) || amount < 0)) fail('Budgets contain an invalid amount.')
  return JSON.stringify({ budgets })
}

function enumerated(values, label) {
  return raw => {
    if (!values.includes(raw)) fail(`${label} is invalid.`)
    return raw
  }
}

const THEME_SETTING_FIELDS = {
  presetVersion: is.num,
  themeId: is.str,
  headingFont: is.str,
  bodyFont: is.str,
  appFont: is.str,
  lineSpacing: is.str
}

function sanitizeBackground(style, label) {
  if (style == null) return undefined
  if (!isPlainObject(style) || !['solid', 'gradient'].includes(style.type)) fail(`${label} contain an invalid background.`)
  return cleanJson(style, label)
}

function sanitizeColors(colors, label) {
  if (!isPlainObject(colors) || Object.values(colors).some(color => !is.str(color))) fail(`${label} contain invalid colors.`)
  return cleanJson(colors, label)
}

// Each sanitizer validates one supported storage value and returns the cleaned JSON string to restore.
export const SANITIZERS = {
  [ACCOUNT_STORAGE_KEY]: raw => {
    const data = parseObject(raw, 'Account data')
    checkVersion(data, ACCOUNT_STORAGE_VERSION, 'Account data')
    const accounts = cleanRecords(data.accounts, 'Accounts', { id: is.int, name: is.str }, {
      type: is.str,
      openingBalance: is.num,
      openingDate: is.str,
      color: is.str,
      defaultCleared: is.bool,
      archived: is.bool
    })
    const transactions = cleanRecords(data.transactions, 'Transactions', {
      id: is.int,
      name: is.str,
      amount: is.num,
      date: is.date
    }, {
      accountId: is.int,
      sequence: is.num,
      cleared: is.bool,
      category: is.str,
      unlinkedOccurrenceIds: is.array
    })
    return JSON.stringify({ version: ACCOUNT_STORAGE_VERSION, accounts, transactions })
  },
  [BILL_STORAGE_KEY]: raw => {
    const data = parseObject(raw, 'Bill data')
    if (data.version !== BILL_STORAGE_VERSION) fail('Bill data uses an unsupported version.')
    const bills = cleanRecords(data.bills, 'Bills', { id: is.int, name: is.str, amount: is.num }, {
      dueDate: is.str,
      frequency: is.str,
      autopay: is.bool,
      accountId: is.int,
      paymentHistory: is.objects
    })
    const incomes = cleanRecords(data.incomes ?? [], 'Income schedules', { id: is.int, name: is.str, amount: is.num }, {
      frequency: is.str,
      accountId: is.int,
      paymentHistory: is.objects
    })
    return JSON.stringify({ version: BILL_STORAGE_VERSION, bills, incomes })
  },
  [PAY_SCHEDULE_STORAGE_KEY]: raw => {
    const data = parseObject(raw, 'Pay schedule')
    if (data.version !== PAY_SCHEDULE_STORAGE_VERSION || !isPlainObject(data.schedule)) fail('Pay schedule is not in the expected format.')
    return JSON.stringify({ version: PAY_SCHEDULE_STORAGE_VERSION, schedule: cleanJson(data.schedule, 'Pay schedule') })
  },
  [DEBT_STORAGE_KEY]: raw => {
    const data = parseObject(raw, 'Debt data')
    if (data.version !== DEBT_STORAGE_VERSION) fail('Debt data uses an unsupported version.')
    const debts = cleanRecords(data.debts, 'Debts', {
      id: is.int,
      name: is.str,
      startingBalance: is.num,
      currentBalance: is.num,
      paymentHistory: is.objects
    })
    return JSON.stringify({ version: DEBT_STORAGE_VERSION, debts })
  },
  [BUDGET_STORAGE_KEY]: sanitizeBudgets,
  [MANUAL_BUDGET_STORAGE_KEY]: sanitizeBudgets,
  [SMART_BUDGET_STORAGE_KEY]: sanitizeBudgets,
  [SMART_DISMISSED_STORAGE_KEY]: raw => {
    const dismissed = cleanJson(parseObject(raw, 'Dismissed suggestions'), 'Dismissed suggestions', true)
    if (Object.values(dismissed).some(value => !is.str(value))) fail('Dismissed suggestions are invalid.')
    return JSON.stringify(dismissed)
  },
  [BUDGET_MODE_STORAGE_KEY]: enumerated(['manual', 'smart'], 'Budget mode'),
  [BUDGET_SETTINGS_STORAGE_KEY]: raw => {
    const settings = loadBudgetSettings(scratchStorage(
      BUDGET_SETTINGS_STORAGE_KEY,
      JSON.stringify(cleanJson(parseObject(raw, 'Budget settings'), 'Budget settings'))
    ))
    const { mode, period, historyMonths, suggestionsEnabled, rolloverEnabled } = settings
    return JSON.stringify({ mode, period, historyMonths, suggestionsEnabled, rolloverEnabled })
  },
  [CATEGORY_STORAGE_KEY]: raw => {
    const { builtInNames = {}, ...rest } = parseObject(raw, 'Categories')
    if (!isPlainObject(builtInNames)) fail('Categories are not in the expected format.')
    checkVersion(rest, CATEGORY_STORAGE_VERSION, 'Categories')
    const cleaned = { ...cleanJson(rest, 'Categories'), builtInNames: cleanJson(builtInNames, 'Categories', true) }
    const config = loadCategoryConfig(scratchStorage(CATEGORY_STORAGE_KEY, JSON.stringify(cleaned)))
    return JSON.stringify({ version: CATEGORY_STORAGE_VERSION, ...config })
  },
  [PAYEE_STORAGE_KEY]: raw => {
    const cleaned = cleanJson(parseObject(raw, 'Payees'), 'Payees')
    const payees = loadPayees(scratchStorage(PAYEE_STORAGE_KEY, JSON.stringify(cleaned)))
    return JSON.stringify({ version: 1, payees })
  },
  [THEME_STORAGE_KEY]: raw => {
    const data = cleanJson(parseObject(raw, 'Theme settings'), 'Theme settings')
    const settings = {}
    for (const [field, check] of Object.entries(THEME_SETTING_FIELDS)) {
      if (data[field] == null) continue
      if (!check(data[field])) fail('Theme settings contain an invalid value.')
      settings[field] = data[field]
    }
    const backgroundStyle = sanitizeBackground(data.backgroundStyle, 'Theme settings')
    if (backgroundStyle) settings.backgroundStyle = backgroundStyle
    if (data.colors != null) settings.colors = sanitizeColors(data.colors, 'Theme settings')
    return JSON.stringify(settings)
  },
  [CUSTOM_THEME_STORAGE_KEY]: raw => {
    let list
    try {
      list = JSON.parse(raw)
    } catch (error) {
      throw new BackupImportError('Custom themes are not valid JSON.', { cause: error })
    }
    const themes = cleanRecords(list, 'Custom themes', { id: is.str, name: is.str }, {
      description: is.str,
      headingFont: is.str,
      bodyFont: is.str,
      appFont: is.str,
      lineSpacing: is.str
    })
    return JSON.stringify(themes.map(theme => {
      const colors = sanitizeColors(theme.colors, 'Custom themes')
      if (!['background', 'card', 'accent', 'text'].every(name => colors[name])) fail('Custom themes contain invalid colors.')
      const clean = { id: theme.id, name: theme.name }
      for (const field of ['description', 'headingFont', 'bodyFont', 'appFont', 'lineSpacing']) {
        if (theme[field] != null) clean[field] = theme[field]
      }
      const backgroundStyle = sanitizeBackground(theme.backgroundStyle, 'Custom themes')
      if (backgroundStyle) clean.backgroundStyle = backgroundStyle
      clean.colors = colors
      return clean
    }))
  },
  [APPEARANCE_SIZE_STORAGE_KEY]: enumerated(APPEARANCE_SIZES, 'Appearance size'),
  [TRANSACTION_SORT_STORAGE_KEY]: enumerated(['asc', 'desc'], 'Transaction sort order')
}
