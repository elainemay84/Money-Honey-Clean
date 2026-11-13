import { ACCOUNT_STORAGE_KEY, loadSavedAccountData } from './accountStorage.js'
import {
  BILL_STORAGE_KEY,
  PAY_SCHEDULE_STORAGE_KEY,
  loadBillData,
  loadPaySchedule
} from './billData.js'
import {
  BUDGET_MODE_STORAGE_KEY,
  BUDGET_SETTINGS_STORAGE_KEY,
  BUDGET_STORAGE_KEY,
  MANUAL_BUDGET_STORAGE_KEY,
  SMART_BUDGET_STORAGE_KEY,
  SMART_DISMISSED_STORAGE_KEY,
  loadBudgetSettings,
  loadBudgets,
  loadDismissedSmartSuggestions
} from './budgetData.js'
import { CATEGORY_STORAGE_KEY, loadCategoryConfig } from './categoryData.js'
import { DEBT_STORAGE_KEY, loadDebts } from './debtData.js'
import { APPEARANCE_SIZE_STORAGE_KEY } from './appearanceData.js'
import { PAYEE_STORAGE_KEY, loadPayees } from './payeeData.js'
import { CUSTOM_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from './themeData.js'
import {
  BackupImportError,
  SANITIZERS,
  TRANSACTION_SORT_STORAGE_KEY,
  isSensitiveKey
} from './backupSanitize.js'

export { BackupImportError }

export { TRANSACTION_SORT_STORAGE_KEY }

export const BACKUP_STORAGE_KEYS = [
  ACCOUNT_STORAGE_KEY,
  BILL_STORAGE_KEY,
  PAY_SCHEDULE_STORAGE_KEY,
  DEBT_STORAGE_KEY,
  BUDGET_STORAGE_KEY,
  MANUAL_BUDGET_STORAGE_KEY,
  SMART_BUDGET_STORAGE_KEY,
  SMART_DISMISSED_STORAGE_KEY,
  BUDGET_MODE_STORAGE_KEY,
  BUDGET_SETTINGS_STORAGE_KEY,
  CATEGORY_STORAGE_KEY,
  PAYEE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  CUSTOM_THEME_STORAGE_KEY,
  APPEARANCE_SIZE_STORAGE_KEY,
  TRANSACTION_SORT_STORAGE_KEY
]

function localDateStamp(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getBackupFilename(date = new Date()) {
  return `money-honey-backup-${localDateStamp(date)}.json`
}

export function createBackupSnapshot(storage = globalThis.localStorage, exportedAt = new Date()) {
  const data = Object.fromEntries(BACKUP_STORAGE_KEYS.map(key => [key, storage.getItem(key)]))
  return {
    formatVersion: 1,
    exportedAt: exportedAt.toISOString(),
    storageKeys: [...BACKUP_STORAGE_KEYS],
    data
  }
}

export function downloadBackup(storage = globalThis.localStorage, exportedAt = new Date()) {
  const snapshot = createBackupSnapshot(storage, exportedAt)
  const filename = getBackupFilename(exportedAt)
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
  return { filename, snapshot }
}

export const BACKUP_FORMAT_VERSION = 1
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function memoryStorage(entries) {
  const values = new Map(entries)
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  }
}

function storageFor(data) {
  return memoryStorage(Object.entries(data).filter(([, value]) => typeof value === 'string'))
}

// Confirms the sanitized data loads through the app's own readers.
const LOADER_CHECKS = {
  [ACCOUNT_STORAGE_KEY]: storage => { loadSavedAccountData(storage) },
  [BILL_STORAGE_KEY]: storage => { loadBillData([], storage) },
  [PAY_SCHEDULE_STORAGE_KEY]: storage => { loadPaySchedule(storage) },
  [DEBT_STORAGE_KEY]: storage => { loadDebts(storage) },
  [MANUAL_BUDGET_STORAGE_KEY]: storage => { loadBudgets('manual', storage) },
  [SMART_BUDGET_STORAGE_KEY]: storage => { loadBudgets('smart', storage) },
  [SMART_DISMISSED_STORAGE_KEY]: storage => { loadDismissedSmartSuggestions(storage) },
  [BUDGET_SETTINGS_STORAGE_KEY]: storage => { loadBudgetSettings(storage) },
  [CATEGORY_STORAGE_KEY]: storage => { loadCategoryConfig(storage) },
  [PAYEE_STORAGE_KEY]: storage => { loadPayees(storage) }
}

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

// Every supported storage key belongs to exactly one category shown in the replacement preview.
export const BACKUP_CATEGORIES = [
  {
    id: 'accounts',
    label: 'Accounts & transactions',
    group: 'data',
    keys: [ACCOUNT_STORAGE_KEY],
    detail: storage => {
      const data = loadSavedAccountData(storage)
      return `${plural(data.accounts.length, 'account')}, ${plural(data.transactions.length, 'transaction')}`
    }
  },
  {
    id: 'bills',
    label: 'Bills & income schedules',
    group: 'data',
    keys: [BILL_STORAGE_KEY],
    detail: storage => {
      const data = loadBillData([], storage)
      return `${plural(data.bills.length, 'bill')}, ${plural(data.incomes.length, 'income schedule')}`
    }
  },
  { id: 'pay-schedule', label: 'Pay schedule', group: 'data', keys: [PAY_SCHEDULE_STORAGE_KEY], detail: () => 'Saved pay schedule' },
  {
    id: 'debts',
    label: 'Debts',
    group: 'data',
    keys: [DEBT_STORAGE_KEY],
    detail: storage => plural(loadDebts(storage).length, 'debt')
  },
  {
    id: 'budgets',
    label: 'Budgets',
    group: 'data',
    keys: [BUDGET_STORAGE_KEY, MANUAL_BUDGET_STORAGE_KEY, SMART_BUDGET_STORAGE_KEY, SMART_DISMISSED_STORAGE_KEY],
    detail: storage => {
      const count = Object.keys(loadBudgets('manual', storage)).length + Object.keys(loadBudgets('smart', storage)).length
      return plural(count, 'budget amount')
    }
  },
  {
    id: 'categories',
    label: 'Categories',
    group: 'data',
    keys: [CATEGORY_STORAGE_KEY],
    detail: storage => plural(loadCategoryConfig(storage).customCategories.length, 'custom category', 'custom categories')
  },
  {
    id: 'payees',
    label: 'Payees',
    group: 'data',
    keys: [PAYEE_STORAGE_KEY],
    detail: storage => plural(loadPayees(storage).length, 'payee')
  },
  { id: 'theme', label: 'Theme settings', group: 'preferences', keys: [THEME_STORAGE_KEY], detail: () => 'Saved theme' },
  {
    id: 'custom-themes',
    label: 'Custom themes',
    group: 'preferences',
    keys: [CUSTOM_THEME_STORAGE_KEY],
    detail: storage => plural(JSON.parse(storage.getItem(CUSTOM_THEME_STORAGE_KEY)).length, 'custom theme')
  },
  { id: 'text-size', label: 'Text size', group: 'preferences', keys: [APPEARANCE_SIZE_STORAGE_KEY], detail: storage => storage.getItem(APPEARANCE_SIZE_STORAGE_KEY) },
  { id: 'sort', label: 'Transaction sort order', group: 'preferences', keys: [TRANSACTION_SORT_STORAGE_KEY], detail: storage => storage.getItem(TRANSACTION_SORT_STORAGE_KEY) },
  { id: 'budget-settings', label: 'Budget mode & settings', group: 'preferences', keys: [BUDGET_MODE_STORAGE_KEY, BUDGET_SETTINGS_STORAGE_KEY], detail: () => 'Saved settings' }
]

function describeCategory(category, data) {
  try {
    return category.detail(storageFor(data))
  } catch {
    return 'Saved data (unreadable)'
  }
}

// Compares what the backup would write to what is on the device, category by category.
export function describeReplacement(backupData, currentData) {
  return BACKUP_CATEGORIES.flatMap(category => {
    const inBackup = category.keys.some(key => backupData[key] !== null)
    const onDevice = category.keys.some(key => currentData[key] !== null)
    if (!inBackup && !onDevice) return []
    const same = inBackup && onDevice && category.keys.every(key => backupData[key] === currentData[key])
    return [{
      id: category.id,
      label: category.label,
      group: category.group,
      action: same ? 'same' : inBackup && onDevice ? 'replace' : onDevice ? 'remove' : 'add',
      backupDetail: inBackup ? describeCategory(category, backupData) : null,
      currentDetail: onDevice ? describeCategory(category, currentData) : null
    }]
  })
}

export function getDataFingerprint(storage = globalThis.localStorage) {
  return JSON.stringify(createBackupSnapshot(storage).data)
}

function sanitizeValue(key, raw) {
  const sanitize = SANITIZERS[key]
  let clean
  try {
    clean = sanitize(raw)
    const scratch = storageFor({ [key]: clean })
    LOADER_CHECKS[key]?.(scratch)
  } catch (error) {
    throw error instanceof BackupImportError
      ? error
      : new BackupImportError(`This backup contains data that Money Honey cannot read (${key}).`, { cause: error })
  }
  return clean
}

function parseFile(text) {
  if (typeof text !== 'string' || text.length === 0) throw new BackupImportError('This file is empty.')
  if (text.length > MAX_BACKUP_BYTES) throw new BackupImportError('This file is too large to be a Money Honey backup.')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new BackupImportError('This file is not valid JSON.', { cause: error })
  }
}

function rejectCredentials(file) {
  const names = [
    ...Object.keys(file),
    ...Object.keys(file.data),
    ...(Array.isArray(file.storageKeys) ? file.storageKeys.filter(name => typeof name === 'string') : [])
  ]
  const found = names.find(isSensitiveKey)
  if (found) {
    throw new BackupImportError(
      `This file contains a "${found.slice(0, 40)}" entry. Money Honey never imports PINs, passwords, tokens, or other authentication data, so this file was rejected.`
    )
  }
}

// Validates and sanitizes a backup file's text without touching any real storage.
export function parseBackup(text, storage = globalThis.localStorage) {
  const file = parseFile(text)
  if (!isPlainObject(file) || !isPlainObject(file.data)) {
    throw new BackupImportError('This is not a Money Honey backup file.')
  }
  if (file.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupImportError(
      Number.isInteger(file.formatVersion) && file.formatVersion > BACKUP_FORMAT_VERSION
        ? 'This backup was created by a newer version of Money Honey and cannot be imported.'
        : 'This backup uses an unsupported format version.'
    )
  }
  if (file.exportedAt !== undefined && (typeof file.exportedAt !== 'string' || Number.isNaN(Date.parse(file.exportedAt)))) {
    throw new BackupImportError('This backup has an invalid export date.')
  }
  rejectCredentials(file)

  const supported = new Set(BACKUP_STORAGE_KEYS)
  const ignoredKeys = Object.keys(file.data).filter(key => !supported.has(key))
  const data = {}
  for (const key of BACKUP_STORAGE_KEYS) {
    const value = Object.hasOwn(file.data, key) ? file.data[key] : null
    if (value !== null && typeof value !== 'string') {
      throw new BackupImportError(`Backup data for ${key} is not in the expected format.`)
    }
    data[key] = value === null ? null : sanitizeValue(key, value)
  }
  if (Object.values(data).every(value => value === null)) {
    throw new BackupImportError('This backup does not contain any Money Honey data.')
  }

  let currentData
  try {
    currentData = createBackupSnapshot(storage).data
  } catch (error) {
    throw new BackupImportError('Money Honey could not read your current data, so nothing was changed.', { cause: error })
  }

  return {
    backup: { formatVersion: file.formatVersion, exportedAt: file.exportedAt ?? null, data, ignoredKeys },
    preview: {
      exportedAt: file.exportedAt ?? null,
      ignoredKeys,
      items: describeReplacement(data, currentData),
      requiresSafetyBackup: Object.values(currentData).some(value => value !== null),
      currentFingerprint: JSON.stringify(currentData)
    }
  }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function getSafetyBackupFilename(date = new Date()) {
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `money-honey-safety-backup-${localDateStamp(date)}-${time}.json`
}

// Starts a download of the current data. Browsers do not report whether the file was actually saved.
export function downloadSafetyBackup(storage = globalThis.localStorage, date = new Date()) {
  const snapshot = createBackupSnapshot(storage, date)
  const filename = getSafetyBackupFilename(date)
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return { filename, fingerprint: JSON.stringify(snapshot.data) }
}

function readCurrentValues(storage) {
  return Object.fromEntries(BACKUP_STORAGE_KEYS.map(key => [key, storage.getItem(key)]))
}

function writeValue(storage, key, value) {
  if (value === null) storage.removeItem(key)
  else storage.setItem(key, value)
}

// Replaces all supported data. If any write fails or does not verify, the previous values are restored.
// expectedFingerprint, when given, must match the current data so a stale safety backup is never trusted.
export function restoreBackup(backup, storage = globalThis.localStorage, { expectedFingerprint } = {}) {
  let previous
  try {
    previous = readCurrentValues(storage)
  } catch (error) {
    throw new BackupImportError('Money Honey could not read your current data, so nothing was changed.', { cause: error })
  }
  if (expectedFingerprint !== undefined && JSON.stringify(previous) !== expectedFingerprint) {
    throw new BackupImportError(
      'Your data changed after the preview and safety backup were created, so nothing was changed. Choose the backup file again.',
      { code: 'stale' }
    )
  }

  try {
    for (const key of BACKUP_STORAGE_KEYS) writeValue(storage, key, backup.data[key])
    for (const key of BACKUP_STORAGE_KEYS) {
      if (storage.getItem(key) !== backup.data[key]) throw new Error(`Could not verify restored data for ${key}.`)
    }
  } catch (error) {
    let rollbackFailed = false
    for (const key of BACKUP_STORAGE_KEYS) {
      try {
        writeValue(storage, key, previous[key])
      } catch {
        rollbackFailed = true
      }
    }
    try {
      if (BACKUP_STORAGE_KEYS.some(key => storage.getItem(key) !== previous[key])) rollbackFailed = true
    } catch {
      rollbackFailed = true
    }
    throw new BackupImportError(
      rollbackFailed
        ? 'The import failed, and Money Honey could not confirm that your previous data was restored.'
        : 'The import failed. Your existing data was kept unchanged.',
      { cause: error, rollbackFailed }
    )
  }
  return { restoredKeys: BACKUP_STORAGE_KEYS.filter(key => backup.data[key] !== null) }
}

export function importBackup(text, storage = globalThis.localStorage) {
  const { backup } = parseBackup(text, storage)
  return restoreBackup(backup, storage)
}
