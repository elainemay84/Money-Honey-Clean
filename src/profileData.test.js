import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { loadSavedAccountData } from './accountStorage.js'
import { BACKUP_STORAGE_KEYS } from './backupData.js'
import { loadBillData } from './billData.js'
import { loadBudgets, loadDismissedSmartSuggestions } from './budgetData.js'
import { loadDebts } from './debtData.js'
import {
  PENDING_OPERATION_STORAGE_KEY,
  PROFILE_ACTION_KEYS,
  ProfileActionError,
  applyProfilePlan,
  deleteProfile,
  getPendingOperation,
  performProfileAction,
  planProfileAction,
  resetAppData
} from './profileData.js'

const KEYS = {
  account: 'money-honey-account-data',
  bills: 'money-honey-bills',
  pay: 'money-honey-pay-schedule',
  debts: 'money-honey-debts',
  legacyBudgets: 'money-honey-budgets',
  manualBudgets: 'money-honey-manual-budgets',
  smartBudgets: 'money-honey-smart-budgets',
  dismissed: 'money-honey-smart-dismissed',
  budgetMode: 'money-honey-budget-mode',
  budgetSettings: 'money-honey-budget-settings',
  categories: 'money-honey-categories',
  payees: 'money-honey-payees',
  theme: 'money-honey-theme-settings',
  customThemes: 'money-honey-custom-themes',
  size: 'money-honey-appearance-size',
  sort: 'money-honey-transaction-sort'
}

const UNRELATED = {
  'other-app-state': '{"keep":"me"}',
  'unrelated-setting': 'x',
  'money-honey-future-feature': 'not in the allowlist'
}

function createStorage(values = {}) {
  const data = new Map(Object.entries(values))
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  }
}

function seededValues() {
  return {
    [KEYS.account]: JSON.stringify({
      version: 1,
      accounts: [
        { id: 1, name: 'Everyday Checking', type: 'Checking', openingBalance: 1500, openingDate: '2026-11-06', color: '#B87522', defaultCleared: true, archived: false },
        { id: 2, name: 'Old Savings', type: 'Savings', openingBalance: 500, openingDate: '2026-11-06', color: '#6E9A72', defaultCleared: false, archived: true }
      ],
      transactions: [
        { id: 1, sequence: 1, accountId: 1, name: 'Paycheck', amount: 1500, date: '2026-11-06', cleared: true, linkedIncomeOccurrenceId: '1:2026-11-06' },
        { id: 2, sequence: 2, accountId: 1, name: 'Card payment', amount: -214, date: '2026-11-07', cleared: true, linkedDebtId: 1, linkedDebtPaymentId: 'p1' }
      ]
    }),
    [KEYS.bills]: JSON.stringify({
      version: 1,
      bills: [{ id: 1, name: 'Card', amount: 214, accountId: 1, debtId: 1, paymentHistory: [{ transactionId: 2 }] }],
      incomes: [{ id: 1, name: 'Pay', amount: 1500, accountId: 1, paymentHistory: [{ transactionId: 1 }] }]
    }),
    [KEYS.pay]: JSON.stringify({ version: 1, schedule: { frequency: 'weekly', nextPayday: '2026-11-20' } }),
    [KEYS.debts]: JSON.stringify({
      version: 1,
      debts: [{ id: 1, name: 'Card', startingBalance: 900, currentBalance: 700, billId: 1, paymentHistory: [{ id: 'p1', transactionId: 2 }] }]
    }),
    [KEYS.legacyBudgets]: '{"budgets":{"Groceries":300}}',
    [KEYS.manualBudgets]: '{"budgets":{"Groceries":250}}',
    [KEYS.smartBudgets]: '{"budgets":{"Gas & Fuel":80}}',
    [KEYS.dismissed]: '{"Shopping":"2026-08,2026-09|40.00"}',
    [KEYS.budgetMode]: 'smart',
    [KEYS.budgetSettings]: '{"mode":"smart","period":"paycheck","historyMonths":6,"suggestionsEnabled":true,"rolloverEnabled":true}',
    [KEYS.categories]: '{"version":1,"customCategories":[{"name":"Boat","type":"expense"}],"builtInNames":{},"disabledBuiltIns":[]}',
    [KEYS.payees]: '{"version":1,"payees":["Corner Store"]}',
    [KEYS.theme]: '{"themeId":"custom-1","lineSpacing":"normal"}',
    [KEYS.customThemes]: '[{"id":"custom-1","name":"Mine","colors":{"background":"#fff","card":"#eee","accent":"#b87522","text":"#000"}}]',
    [KEYS.size]: 'large',
    [KEYS.sort]: 'asc'
  }
}

function seeded() {
  return createStorage({ ...seededValues(), ...UNRELATED })
}

const snapshot = storage => Object.fromEntries([...storage.data.entries()].sort())

function changedKeys(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => before[key] !== after[key])
    .sort()
}

test('every action partitions the existing Money Honey keys exactly once', () => {
  for (const [kind, groups] of Object.entries(PROFILE_ACTION_KEYS)) {
    const all = [...groups.resetAccounts, ...groups.empty, ...groups.remove, ...groups.preserve]
    assert.equal(new Set(all).size, all.length, `${kind} lists a key twice`)
    assert.deepEqual([...all].sort(), [...BACKUP_STORAGE_KEYS].sort(), kind)
  }
  assert.deepEqual(PROFILE_ACTION_KEYS.delete.preserve, [])
})

test('every Money Honey storage key used by the app source is covered by the allowlist', () => {
  const sourceKeys = new Set()
  for (const file of readdirSync(new URL('.', import.meta.url))) {
    if (!/\.(js|jsx)$/.test(file) || file.endsWith('.test.js')) continue
    const text = readFileSync(new URL(file, import.meta.url), 'utf8')
    for (const [, key] of text.matchAll(/'(money-honey-[a-z-]+)'/g)) sourceKeys.add(key)
  }
  const notStorageKeys = [...sourceKeys].filter(key => key.endsWith('-updated') || key.startsWith('money-honey-backup-'))
  const known = new Set([
    ...BACKUP_STORAGE_KEYS,
    PENDING_OPERATION_STORAGE_KEY,
    'money-honey-profile-action-done',
    ...notStorageKeys
  ])
  assert.deepEqual([...sourceKeys].filter(key => !known.has(key)), [])
})

test('Reset App Data changes exactly the reset keys and keeps everything else byte-for-byte', () => {
  const storage = seeded()
  const before = snapshot(storage)

  const result = resetAppData(storage)
  const after = snapshot(storage)

  assert.deepEqual(changedKeys(before, after), [
    KEYS.account, KEYS.bills, KEYS.debts, KEYS.legacyBudgets, KEYS.manualBudgets,
    KEYS.pay, KEYS.smartBudgets, KEYS.dismissed
  ].sort())
  for (const key of [KEYS.categories, KEYS.payees, KEYS.theme, KEYS.customThemes, KEYS.size, KEYS.sort, KEYS.budgetMode, KEYS.budgetSettings, ...Object.keys(UNRELATED)]) {
    assert.equal(after[key], before[key], key)
  }
  assert.deepEqual(result.removedKeys.sort(), [KEYS.debts, KEYS.pay, KEYS.legacyBudgets, KEYS.manualBudgets, KEYS.smartBudgets, KEYS.dismissed].sort())
  assert.equal(storage.getItem(PENDING_OPERATION_STORAGE_KEY), null)
})

test('Reset App Data keeps accounts with their names and types, zeroes balances, and leaves no linked orphans', () => {
  const storage = seeded()
  resetAppData(storage)

  const data = loadSavedAccountData(storage)
  assert.deepEqual(data.accounts.map(account => [account.id, account.name, account.type, account.openingBalance]), [
    [1, 'Everyday Checking', 'Checking', 0],
    [2, 'Old Savings', 'Savings', 0]
  ])
  assert.equal(data.accounts[0].color, '#B87522')
  assert.equal(data.accounts[0].defaultCleared, true)
  assert.equal(data.accounts[1].archived, true)
  assert.deepEqual(data.transactions, [])
  assert.deepEqual(loadBillData(['demo'], storage), { version: 1, bills: [], incomes: [] })
  assert.deepEqual(loadDebts(storage), [])
  assert.deepEqual(loadBudgets('manual', storage), {})
  assert.deepEqual(loadBudgets('smart', storage), {})
  assert.deepEqual(loadDismissedSmartSuggestions(storage), {})
  assert.equal(storage.getItem(KEYS.pay), null)
})

test('Reset App Data stops before changing anything when account data cannot be read', () => {
  for (const bad of ['{oops', '{"accounts":{},"transactions":[]}', '{"accounts":[null],"transactions":[]}']) {
    const storage = seeded()
    storage.setItem(KEYS.account, bad)
    const before = snapshot(storage)

    assert.throws(() => resetAppData(storage), ProfileActionError)
    assert.deepEqual(snapshot(storage), before)
  }
})

test('Reset App Data with no saved accounts writes empty data instead of letting demo data return', () => {
  const storage = seeded()
  storage.removeItem(KEYS.account)

  resetAppData(storage)

  assert.deepEqual(loadSavedAccountData(storage), { accounts: [], transactions: [] })
})

test('Delete Profile removes every Money Honey key, writes empty accounts and bills, and spares unrelated keys', () => {
  const storage = seeded()

  const result = deleteProfile(storage)
  const after = snapshot(storage)

  assert.deepEqual(Object.keys(after).sort(), [KEYS.account, KEYS.bills, ...Object.keys(UNRELATED)].sort())
  for (const [key, value] of Object.entries(UNRELATED)) assert.equal(after[key], value, key)
  assert.deepEqual(loadSavedAccountData(storage), { accounts: [], transactions: [] })
  assert.deepEqual(loadBillData(['demo'], storage), { version: 1, bills: [], incomes: [] })
  assert.equal(result.removedKeys.length, 14)
  assert.equal(storage.getItem(PENDING_OPERATION_STORAGE_KEY), null)
})

test('both actions are repeatable on already-cleared data', () => {
  const storage = seeded()
  resetAppData(storage)
  const afterReset = snapshot(storage)
  resetAppData(storage)
  assert.deepEqual(snapshot(storage), afterReset)
  deleteProfile(storage)
  const afterDelete = snapshot(storage)
  deleteProfile(storage)
  assert.deepEqual(snapshot(storage), afterDelete)
})

test('plans never include a key outside the action allowlist, and a forged plan is refused untouched', () => {
  for (const kind of ['reset', 'delete']) {
    const plan = planProfileAction(kind, seeded())
    const allowed = new Set([...PROFILE_ACTION_KEYS[kind].resetAccounts, ...PROFILE_ACTION_KEYS[kind].empty, ...PROFILE_ACTION_KEYS[kind].remove])
    assert.deepEqual(Object.keys(plan).filter(key => !allowed.has(key)), [])
  }

  for (const forged of ['other-app-state', KEYS.categories, KEYS.theme]) {
    const storage = seeded()
    const before = snapshot(storage)
    assert.throws(() => applyProfilePlan('reset', { [forged]: null }, storage), /not allowed/)
    assert.deepEqual(snapshot(storage), before)
  }
  assert.throws(() => planProfileAction('wipe', seeded()), ProfileActionError)
  assert.throws(() => performProfileAction('wipe', seeded()), ProfileActionError)
})

for (const kind of ['reset', 'delete']) {
  test(`${kind}: a storage failure at any write rolls everything back and clears the marker`, () => {
    const planSize = Object.keys(planProfileAction(kind, seeded())).length
    for (let failAt = 1; failAt <= planSize + 1; failAt += 1) {
      const storage = seeded()
      const before = snapshot(storage)
      let writes = 0
      const failing = {
        getItem: storage.getItem,
        setItem(key, value) {
          if (key !== PENDING_OPERATION_STORAGE_KEY && ++writes === failAt) throw new DOMException('Quota exceeded', 'QuotaExceededError')
          storage.setItem(key, value)
        },
        removeItem(key) {
          if (key !== PENDING_OPERATION_STORAGE_KEY && ++writes === failAt) throw new Error('remove failed')
          storage.removeItem(key)
        }
      }

      if (failAt > planSize) {
        performProfileAction(kind, failing)
        continue
      }
      assert.throws(() => performProfileAction(kind, failing), error =>
        error instanceof ProfileActionError
        && error.rollbackFailed === false
        && /Nothing was deleted and your data is unchanged/.test(error.message), `failAt ${failAt}`)
      assert.deepEqual(snapshot(storage), before, `failAt ${failAt}`)
      assert.equal(getPendingOperation(storage), null)
    }
  })

  test(`${kind}: a write that silently does not stick is detected and rolled back`, () => {
    const storage = seeded()
    const before = snapshot(storage)
    let dropped = false
    const lossy = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem(key, value) {
        if (!dropped && key === KEYS.bills) {
          dropped = true
          return
        }
        storage.setItem(key, value)
      }
    }

    assert.throws(() => performProfileAction(kind, lossy), error => error.rollbackFailed === false)
    assert.deepEqual(snapshot(storage), before)
  })

  test(`${kind}: failing to start leaves everything untouched`, () => {
    const storage = seeded()
    const before = snapshot(storage)
    const refusing = {
      getItem: storage.getItem,
      removeItem: storage.removeItem,
      setItem(key, value) {
        if (key === PENDING_OPERATION_STORAGE_KEY) throw new Error('blocked')
        storage.setItem(key, value)
      }
    }

    assert.throws(() => performProfileAction(kind, refusing), /nothing was changed/)
    assert.deepEqual(snapshot(storage), before)
  })

  test(`${kind}: if rollback also fails the error says so and the interrupted marker stays`, () => {
    const storage = seeded()
    let writes = 0
    const dying = {
      getItem: storage.getItem,
      setItem(key, value) {
        if (key === PENDING_OPERATION_STORAGE_KEY || ++writes === 1) return storage.setItem(key, value)
        throw new Error('storage died')
      },
      removeItem(key) {
        if (key !== PENDING_OPERATION_STORAGE_KEY) throw new Error('storage died')
        storage.removeItem(key)
      }
    }

    assert.throws(() => performProfileAction(kind, dying), error =>
      error.rollbackFailed === true
      && /could not confirm that your data was put back/.test(error.message)
      && !/unchanged/.test(error.message))
    assert.equal(getPendingOperation(storage)?.kind, kind)
  })
}

test('an interrupted operation leaves a marker that the next launch can detect', () => {
  const storage = seeded()
  storage.setItem(PENDING_OPERATION_STORAGE_KEY, JSON.stringify({ kind: 'reset', startedAt: '2026-11-12T00:00:00.000Z' }))
  assert.equal(getPendingOperation(storage).kind, 'reset')
  storage.setItem(PENDING_OPERATION_STORAGE_KEY, 'garbage')
  assert.equal(getPendingOperation(storage).kind, 'unknown')
  storage.removeItem(PENDING_OPERATION_STORAGE_KEY)
  assert.equal(getPendingOperation(storage), null)
})
