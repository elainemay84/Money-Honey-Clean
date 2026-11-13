import { ACCOUNT_STORAGE_KEY, ACCOUNT_STORAGE_VERSION, loadSavedAccountData } from './accountStorage.js'
import {
  BILL_STORAGE_KEY,
  BILL_STORAGE_VERSION,
  PAY_SCHEDULE_STORAGE_KEY
} from './billData.js'
import {
  BUDGET_MODE_STORAGE_KEY,
  BUDGET_SETTINGS_STORAGE_KEY,
  BUDGET_STORAGE_KEY,
  MANUAL_BUDGET_STORAGE_KEY,
  SMART_BUDGET_STORAGE_KEY,
  SMART_DISMISSED_STORAGE_KEY
} from './budgetData.js'
import { CATEGORY_STORAGE_KEY } from './categoryData.js'
import { DEBT_STORAGE_KEY } from './debtData.js'
import { APPEARANCE_SIZE_STORAGE_KEY } from './appearanceData.js'
import { PAYEE_STORAGE_KEY } from './payeeData.js'
import { CUSTOM_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from './themeData.js'
import { TRANSACTION_SORT_STORAGE_KEY } from './backupSanitize.js'

// Written before any change and removed after a verified finish. If it is still present on the next
// launch, an earlier reset or delete was interrupted.
export const PENDING_OPERATION_STORAGE_KEY = 'money-honey-pending-operation'

// These are the only localStorage keys a reset or delete may ever touch. Each key is listed exactly once
// per action. The app seeds demo accounts and bills when those two keys are missing, so they are rewritten
// with empty data instead of being removed.
export const PROFILE_ACTION_KEYS = {
  reset: {
    // Accounts stay (names, types, settings) with balances set to zero and no transactions.
    resetAccounts: [ACCOUNT_STORAGE_KEY],
    // Rewritten as empty containers: bills and recurring income schedules.
    empty: [BILL_STORAGE_KEY],
    // Deleted: debts and payment history, pay schedule (paycheck forecast), and every budget store.
    remove: [
      DEBT_STORAGE_KEY,
      PAY_SCHEDULE_STORAGE_KEY,
      BUDGET_STORAGE_KEY,
      MANUAL_BUDGET_STORAGE_KEY,
      SMART_BUDGET_STORAGE_KEY,
      SMART_DISMISSED_STORAGE_KEY
    ],
    // Never touched.
    preserve: [
      CATEGORY_STORAGE_KEY,
      PAYEE_STORAGE_KEY,
      THEME_STORAGE_KEY,
      CUSTOM_THEME_STORAGE_KEY,
      APPEARANCE_SIZE_STORAGE_KEY,
      TRANSACTION_SORT_STORAGE_KEY,
      BUDGET_MODE_STORAGE_KEY,
      BUDGET_SETTINGS_STORAGE_KEY
    ]
  },
  delete: {
    resetAccounts: [],
    empty: [ACCOUNT_STORAGE_KEY, BILL_STORAGE_KEY],
    remove: [
      DEBT_STORAGE_KEY,
      PAY_SCHEDULE_STORAGE_KEY,
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
    ],
    preserve: []
  }
}

export class ProfileActionError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'ProfileActionError'
    this.rollbackFailed = options?.rollbackFailed === true
  }
}

function allowedKeys(kind) {
  const { resetAccounts, empty, remove } = PROFILE_ACTION_KEYS[kind]
  return new Set([...resetAccounts, ...empty, ...remove])
}

function emptyAccountData() {
  return JSON.stringify({ version: ACCOUNT_STORAGE_VERSION, accounts: [], transactions: [] })
}

function emptyBillData() {
  return JSON.stringify({ version: BILL_STORAGE_VERSION, bills: [], incomes: [] })
}

function resetAccountData(storage) {
  if (storage.getItem(ACCOUNT_STORAGE_KEY) === null) return emptyAccountData()
  let data
  try {
    data = loadSavedAccountData(storage)
    if (data.accounts.some(account => account === null || typeof account !== 'object' || Array.isArray(account))) {
      throw new Error('Invalid account record.')
    }
  } catch (error) {
    throw new ProfileActionError('Your account data could not be read, so nothing was changed.', { cause: error })
  }
  return JSON.stringify({
    version: ACCOUNT_STORAGE_VERSION,
    accounts: data.accounts.map(account => ({ ...account, openingBalance: 0 })),
    transactions: []
  })
}

// Maps each key to its new value, or null to remove it. Nothing is written here.
export function planProfileAction(kind, storage = globalThis.localStorage) {
  if (!Object.hasOwn(PROFILE_ACTION_KEYS, kind)) throw new ProfileActionError('Unknown action. Nothing was changed.')
  const keys = PROFILE_ACTION_KEYS[kind]
  const plan = {}
  for (const key of keys.resetAccounts) plan[key] = resetAccountData(storage)
  for (const key of keys.empty) plan[key] = key === ACCOUNT_STORAGE_KEY ? emptyAccountData() : emptyBillData()
  for (const key of keys.remove) plan[key] = null
  return plan
}

function readKeys(storage, keys) {
  return Object.fromEntries(keys.map(key => [key, storage.getItem(key)]))
}

function writeValue(storage, key, value) {
  if (value === null) storage.removeItem(key)
  else storage.setItem(key, value)
}

// Applies the plan and verifies it. On any failure every changed key is put back and verified; only a
// confirmed rollback is reported as "unchanged".
export function applyProfilePlan(kind, plan, storage = globalThis.localStorage, now = new Date()) {
  const allowed = allowedKeys(kind)
  const keys = Object.keys(plan)
  if (keys.some(key => !allowed.has(key))) {
    throw new ProfileActionError('This action tried to change data it is not allowed to touch. Nothing was changed.')
  }

  let previous
  try {
    previous = readKeys(storage, keys)
    storage.setItem(PENDING_OPERATION_STORAGE_KEY, JSON.stringify({ kind, startedAt: now.toISOString() }))
  } catch (error) {
    throw new ProfileActionError('Money Honey could not safely start this change, so nothing was changed.', { cause: error })
  }

  try {
    for (const key of keys) writeValue(storage, key, plan[key])
    for (const key of keys) {
      if (storage.getItem(key) !== plan[key]) throw new Error(`Could not verify the change to ${key}.`)
    }
  } catch (error) {
    let rollbackFailed = false
    for (const key of keys) {
      try {
        writeValue(storage, key, previous[key])
      } catch {
        rollbackFailed = true
      }
    }
    try {
      if (keys.some(key => storage.getItem(key) !== previous[key])) rollbackFailed = true
    } catch {
      rollbackFailed = true
    }
    if (!rollbackFailed) {
      try {
        storage.removeItem(PENDING_OPERATION_STORAGE_KEY)
      } catch {
        // The marker only triggers an extra warning; the data itself is confirmed restored.
      }
    }
    throw new ProfileActionError(
      rollbackFailed
        ? 'The change failed, and Money Honey could not confirm that your data was put back.'
        : 'The change failed. Nothing was deleted and your data is unchanged.',
      { cause: error, rollbackFailed }
    )
  }

  try {
    storage.removeItem(PENDING_OPERATION_STORAGE_KEY)
  } catch {
    // The change is verified; a leftover marker only shows a precautionary notice on the next launch.
  }
  return { kind, changedKeys: keys, removedKeys: keys.filter(key => plan[key] === null) }
}

export function resetAppData(storage = globalThis.localStorage) {
  return applyProfilePlan('reset', planProfileAction('reset', storage), storage)
}

export function deleteProfile(storage = globalThis.localStorage) {
  return applyProfilePlan('delete', planProfileAction('delete', storage), storage)
}

export function performProfileAction(kind, storage = globalThis.localStorage) {
  if (kind === 'reset') return resetAppData(storage)
  if (kind === 'delete') return deleteProfile(storage)
  throw new ProfileActionError('Unknown action. Nothing was changed.')
}

export function getPendingOperation(storage = globalThis.localStorage) {
  try {
    const saved = storage.getItem(PENDING_OPERATION_STORAGE_KEY)
    if (saved === null) return null
    const value = JSON.parse(saved)
    return value && ['reset', 'delete'].includes(value.kind) ? value : { kind: 'unknown' }
  } catch {
    return { kind: 'unknown' }
  }
}

export function clearPendingOperation(storage = globalThis.localStorage) {
  try {
    storage.removeItem(PENDING_OPERATION_STORAGE_KEY)
  } catch {
    // Nothing more can be done if storage is unavailable.
  }
}
