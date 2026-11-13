import assert from 'node:assert/strict'
import test from 'node:test'
import { saveAccountData } from './accountStorage.js'
import { saveBillData, savePaySchedule } from './billData.js'
import { saveBudgets } from './budgetData.js'
import { saveCategories } from './categoryData.js'
import { savePayees } from './payeeData.js'
import {
  BACKUP_STORAGE_KEYS,
  BACKUP_CATEGORIES,
  BackupImportError,
  createBackupSnapshot,
  downloadSafetyBackup,
  getBackupFilename,
  getDataFingerprint,
  getSafetyBackupFilename,
  importBackup,
  parseBackup,
  restoreBackup
} from './backupData.js'
import { isSensitiveKey } from './backupSanitize.js'
import { CUSTOM_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from './themeData.js'

function withStorage(values = {}) {
  const data = new Map(Object.entries(values))
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  }
  return { storage, values: data }
}

test('backup includes every supported storage key and excludes credentials', () => {
  const { storage } = withStorage(Object.fromEntries(
    BACKUP_STORAGE_KEYS.map(key => [key, `${key}-value`])
  ))
  storage.setItem('money-honey-pin', '1234')
  storage.setItem('money-honey-auth-token', 'secret')

  const snapshot = createBackupSnapshot(storage, new Date('2026-11-12T21:00:00.000Z'))

  assert.equal(snapshot.formatVersion, 1)
  assert.equal(snapshot.exportedAt, '2026-11-12T21:00:00.000Z')
  assert.deepEqual(snapshot.storageKeys, BACKUP_STORAGE_KEYS)
  for (const key of BACKUP_STORAGE_KEYS) {
    assert.equal(snapshot.data[key], `${key}-value`)
  }
  assert.equal(Object.hasOwn(snapshot.data, 'money-honey-pin'), false)
  assert.equal(Object.hasOwn(snapshot.data, 'money-honey-auth-token'), false)
})

test('creating a backup is read-only and uses the export date in its filename', () => {
  const { storage, values } = withStorage({
    'money-honey-account-data': '{"accounts":[],"transactions":[]}'
  })
  const before = [...values.entries()]
  const date = new Date('2026-11-12T21:00:00.000Z')

  createBackupSnapshot(storage, date)

  assert.deepEqual([...values.entries()], before)
  assert.equal(getBackupFilename(date), 'money-honey-backup-2026-11-12.json')
})

function sampleStorage() {
  const { storage, values } = withStorage()
  saveAccountData(
    [{ id: 1, name: 'Checking', type: 'checking', balance: 100 }],
    [
      { id: 1, accountId: 1, name: 'Coffee', amount: -25, date: '2026-11-01' },
      { id: 2, accountId: 1, name: 'Refund', amount: 5, date: '2026-11-02' }
    ],
    storage
  )
  saveBillData({ bills: [{ id: 1, name: 'Rent', amount: 900 }], incomes: [{ id: 1, name: 'Pay', amount: 1000 }] }, storage)
  savePaySchedule({ frequency: 'weekly', nextPayday: '2026-11-20' }, storage)
  saveBudgets({ Groceries: 200 }, 'manual', storage)
  saveCategories([{ id: 'custom-1', name: 'Axolotl Care', type: 'expense' }], storage)
  savePayees(['Corner Store'], storage)
  storage.setItem(THEME_STORAGE_KEY, JSON.stringify({ themeId: 'mine' }))
  storage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify([
    {
      id: 'mine',
      name: 'Mine',
      description: 'Custom theme',
      headingFont: 'serif',
      bodyFont: 'sans',
      appFont: 'sans',
      lineSpacing: 'normal',
      backgroundStyle: { type: 'gradient', color1: '#fff', color2: '#eee', direction: 'to bottom' },
      colors: { background: '#fff', card: '#eee', accent: '#b87522', text: '#000', glow: '#ff0' }
    }
  ]))
  return { storage, values }
}

function backupText(mutate) {
  const snapshot = createBackupSnapshot(sampleStorage().storage, new Date('2026-11-12T21:00:00.000Z'))
  mutate?.(snapshot)
  return JSON.stringify(snapshot)
}

const existingData = {
  'money-honey-account-data': '{"version":1,"accounts":[{"id":9,"name":"Old"}],"transactions":[]}',
  'money-honey-payees': '{"version":1,"payees":["Old Payee"]}',
  'money-honey-pin': '1234'
}

test('a valid exported backup is previewed without changing storage', () => {
  const { storage, values } = withStorage(existingData)
  const before = [...values.entries()]

  const { preview } = parseBackup(backupText(), storage)
  const byId = Object.fromEntries(preview.items.map(item => [item.id, item]))

  assert.equal(byId.accounts.backupDetail, '1 account, 2 transactions')
  assert.equal(byId.accounts.currentDetail, '1 account, 0 transactions')
  assert.equal(byId.accounts.action, 'replace')
  assert.equal(byId.bills.backupDetail, '1 bill, 1 income schedule')
  assert.equal(byId.bills.action, 'add')
  assert.equal(byId['pay-schedule'].action, 'add')
  assert.equal(byId.budgets.backupDetail, '1 budget amount')
  assert.equal(byId.categories.backupDetail, '1 custom category')
  assert.equal(byId['custom-themes'].backupDetail, '1 custom theme')
  assert.equal(byId.payees.currentDetail, '1 payee')
  assert.equal(byId.payees.action, 'replace')
  assert.equal(preview.exportedAt, '2026-11-12T21:00:00.000Z')
  assert.equal(preview.requiresSafetyBackup, true)
  assert.deepEqual([...values.entries()], before)
})

test('the preview lists omitted themes and preferences as removals and unchanged data as such', () => {
  const { storage } = withStorage({
    ...existingData,
    'money-honey-custom-themes': JSON.stringify([
      { id: 'old', name: 'Old', colors: { background: '#fff', card: '#eee', accent: '#b87522', text: '#000' } }
    ]),
    'money-honey-appearance-size': 'large',
    'money-honey-transaction-sort': 'asc'
  })
  const text = backupText(snapshot => {
    snapshot.data['money-honey-custom-themes'] = null
    snapshot.data['money-honey-theme-settings'] = null
    snapshot.data['money-honey-payees'] = existingData['money-honey-payees']
  })
  storage.setItem('money-honey-payees', existingData['money-honey-payees'])

  const { preview } = parseBackup(text, storage)
  const action = id => preview.items.find(item => item.id === id)?.action

  assert.equal(action('custom-themes'), 'remove')
  assert.equal(action('text-size'), 'remove')
  assert.equal(action('sort'), 'remove')
  assert.equal(action('theme'), undefined)
  assert.equal(action('payees'), 'same')
  assert.match(preview.items.find(item => item.id === 'custom-themes').currentDetail, /1 custom theme/)
  assert.equal(preview.items.find(item => item.id === 'text-size').group, 'preferences')
})

test('every supported storage key belongs to exactly one preview category and none look like credentials', () => {
  const categorized = BACKUP_CATEGORIES.flatMap(category => category.keys)
  assert.deepEqual([...categorized].sort(), [...BACKUP_STORAGE_KEYS].sort())
  assert.equal(BACKUP_STORAGE_KEYS.some(isSensitiveKey), false)
})

test('importing replaces supported data and clears absent keys, leaving credentials untouched', () => {
  const { storage, values } = withStorage({ ...existingData, 'money-honey-appearance-size': 'large' })

  const { restoredKeys } = importBackup(backupText(), storage)
  const expected = createBackupSnapshot(sampleStorage().storage).data

  for (const key of BACKUP_STORAGE_KEYS) assert.equal(storage.getItem(key), expected[key], key)
  assert.equal(storage.getItem('money-honey-appearance-size'), null)
  assert.ok(restoredKeys.includes('money-honey-custom-themes'))
  assert.equal(values.get('money-honey-pin'), '1234')
})

test('unsupported but harmless entries are skipped and listed', () => {
  const { storage } = withStorage()
  const text = backupText(snapshot => { snapshot.data['money-honey-experiment'] = 'x' })

  assert.deepEqual(parseBackup(text, storage).backup.ignoredKeys, ['money-honey-experiment'])
  importBackup(text, storage)
  assert.equal(storage.getItem('money-honey-experiment'), null)
})

test('a restored backup re-exports to the same data', () => {
  const { storage } = withStorage(existingData)
  importBackup(backupText(), storage)
  assert.deepEqual(createBackupSnapshot(storage).data, createBackupSnapshot(sampleStorage().storage).data)
})

const invalidFiles = {
  'empty file': () => '',
  'non-JSON text': () => 'not json',
  'JSON that is not a backup': () => JSON.stringify([1, 2]),
  'missing data': () => backupText(snapshot => { delete snapshot.data }),
  'unsupported version': () => backupText(snapshot => { snapshot.formatVersion = 99 }),
  'invalid export date': () => backupText(snapshot => { snapshot.exportedAt = 'yesterday' }),
  'no supported data': () => JSON.stringify({ formatVersion: 1, data: { 'money-honey-pin': '1234' } }),
  'non-string value': () => backupText(snapshot => { snapshot.data['money-honey-payees'] = { payees: [] } }),
  'corrupt JSON value': () => backupText(snapshot => { snapshot.data['money-honey-account-data'] = '{oops' }),
  'wrong account shape': () => backupText(snapshot => { snapshot.data['money-honey-account-data'] = '{"accounts":{},"transactions":[]}' }),
  'invalid record': () => backupText(snapshot => { snapshot.data['money-honey-account-data'] = '{"accounts":[null],"transactions":[]}' }),
  'wrong bill version': () => backupText(snapshot => { snapshot.data['money-honey-bills'] = '{"version":7,"bills":[]}' }),
  'invalid custom theme': () => backupText(snapshot => { snapshot.data[CUSTOM_THEME_STORAGE_KEY] = '[{"id":"x"}]' }),
  'duplicate account ids': () => backupText(snapshot => { snapshot.data['money-honey-account-data'] = '{"accounts":[{"id":1,"name":"A"},{"id":1,"name":"B"}],"transactions":[]}' }),
  'transaction with bad date': () => backupText(snapshot => { snapshot.data['money-honey-account-data'] = '{"accounts":[],"transactions":[{"id":1,"name":"x","amount":1,"date":"yesterday"}]}' }),
  'transaction with non-numeric amount': () => backupText(snapshot => { snapshot.data['money-honey-account-data'] = '{"accounts":[],"transactions":[{"id":1,"name":"x","amount":"1","date":"2026-11-01"}]}' }),
  'negative budget': () => backupText(snapshot => { snapshot.data['money-honey-manual-budgets'] = '{"budgets":{"Food":-5}}' }),
  'prototype pollution key': () => backupText(snapshot => { snapshot.data['money-honey-account-data'] = '{"accounts":[{"id":1,"name":"A","__proto__":{"x":1}}],"transactions":[]}' }),
  'credential entry at top level': () => backupText(snapshot => { snapshot.data['money-honey-pin'] = '9999' }),
  'credential entry next to file data': () => backupText(snapshot => { snapshot.authToken = 'abc' }),
  'credential-like storage key name': () => backupText(snapshot => { snapshot.storageKeys.push('money-honey-reset-pin') }),
  'PIN nested in an account': () => backupText(snapshot => { snapshot.data['money-honey-account-data'] = '{"accounts":[{"id":1,"name":"A","security":{"resetPin":"1234"}}],"transactions":[]}' }),
  'password in a transaction': () => backupText(snapshot => { snapshot.data['money-honey-account-data'] = '{"accounts":[],"transactions":[{"id":1,"name":"x","amount":1,"date":"2026-11-01","password":"hunter2"}]}' }),
  'token in a bill payment history': () => backupText(snapshot => { snapshot.data['money-honey-bills'] = '{"version":1,"bills":[{"id":1,"name":"Rent","amount":1,"paymentHistory":[{"dueDate":"2026-11-01","accessToken":"t"}]}],"incomes":[]}' }),
  'credential in theme settings': () => backupText(snapshot => { snapshot.data[THEME_STORAGE_KEY] = '{"themeId":"x","apiKey":"k"}' }),
  'credential in a debt': () => backupText(snapshot => { snapshot.data['money-honey-debts'] = '{"version":1,"debts":[{"id":1,"name":"Card","startingBalance":1,"currentBalance":1,"paymentHistory":[],"authentication":{"secret":"s"}}]}' }),
  'invalid preference': () => backupText(snapshot => { snapshot.data['money-honey-appearance-size'] = 'huge' })
}

for (const [name, build] of Object.entries(invalidFiles)) {
  test(`invalid backup is rejected and preserves data: ${name}`, () => {
    const { storage, values } = withStorage(existingData)
    const before = [...values.entries()]

    assert.throws(() => importBackup(build(), storage), BackupImportError)
    assert.deepEqual([...values.entries()], before)
  })
}

test('declining the confirmation leaves storage untouched', () => {
  const { storage, values } = withStorage(existingData)
  const before = [...values.entries()]

  parseBackup(backupText(), storage)

  assert.deepEqual([...values.entries()], before)
})

test('a write failure part-way through rolls every key back', () => {
  const { storage, values } = withStorage({ ...existingData, 'money-honey-theme-settings': '{"themeId":"old"}' })
  const before = [...values.entries()]
  const { backup } = parseBackup(backupText(), storage)
  let writes = 0
  const failing = {
    ...storage,
    setItem(key, value) {
      if (++writes === 4) throw new DOMException('Quota exceeded', 'QuotaExceededError')
      storage.setItem(key, value)
    }
  }

  assert.throws(() => restoreBackup(backup, failing), /existing data was kept unchanged/)
  assert.deepEqual(Object.fromEntries(values), Object.fromEntries(before))
})

test('a write that does not verify rolls back', () => {
  const { storage, values } = withStorage(existingData)
  const before = Object.fromEntries(values)
  const { backup } = parseBackup(backupText(), storage)
  let truncated = false
  const lossy = {
    ...storage,
    setItem(key, value) {
      const lose = !truncated && key === 'money-honey-payees'
      truncated ||= lose
      storage.setItem(key, lose ? 'truncated' : value)
    }
  }

  assert.throws(() => restoreBackup(backup, lossy), BackupImportError)
  assert.deepEqual(Object.fromEntries(values), before)
})

test('unreadable current storage stops the import before any write', () => {
  const { storage } = withStorage(existingData)
  const { backup } = parseBackup(backupText(), storage)
  let wrote = false
  const broken = {
    getItem() { throw new Error('denied') },
    setItem() { wrote = true },
    removeItem() { wrote = true }
  }

  assert.throws(() => restoreBackup(backup, broken), /nothing was changed/)
  assert.equal(wrote, false)
})

test('an unrecoverable rollback is reported honestly', () => {
  const { storage } = withStorage(existingData)
  const { backup } = parseBackup(backupText(), storage)
  const failing = { ...storage, setItem() { throw new Error('disk full') } }

  assert.throws(() => restoreBackup(backup, failing), /could not confirm that your previous data was restored/)
})

test('credential fields are detected without flagging ordinary field names', () => {
  for (const key of ['pin', 'resetPin', 'user_password', 'accessToken', 'authToken', 'api-key', 'apiKey', 'PIN', 'money-honey-pin', 'securitypin', 'secretAnswer']) {
    assert.equal(isSensitiveKey(key), true, key)
  }
  for (const key of ['pinned', 'shipping', 'mapping', 'spinner', 'author', 'name', 'amount', 'paymentHistory', 'openingBalance']) {
    assert.equal(isSensitiveKey(key), false, key)
  }
})

test('user-entered budget and category names are not mistaken for credential fields', () => {
  const { storage } = withStorage()
  const text = backupText(snapshot => {
    snapshot.data['money-honey-manual-budgets'] = '{"budgets":{"Secret Santa":40,"Pin Money":10}}'
    snapshot.data['money-honey-account-data'] = '{"accounts":[{"id":1,"name":"Token Savings","pinned":true}],"transactions":[]}'
  })

  importBackup(text, storage)

  assert.match(storage.getItem('money-honey-manual-budgets'), /Secret Santa/)
  assert.match(storage.getItem('money-honey-account-data'), /"pinned":true/)
})

test('restored data is sanitized to the supported schema', () => {
  const { storage } = withStorage()
  const text = backupText(snapshot => {
    snapshot.data[THEME_STORAGE_KEY] = JSON.stringify({
      themeId: 'mine', lineSpacing: 'normal', surprise: 'x', colors: { accent: '#fff' }
    })
    snapshot.data[CUSTOM_THEME_STORAGE_KEY] = JSON.stringify([{
      id: 'mine', name: 'Mine', extra: 1,
      colors: { background: '#fff', card: '#eee', accent: '#b87522', text: '#000' }
    }])
    snapshot.data['money-honey-budget-settings'] = JSON.stringify({ mode: 'smart', historyMonths: 99, surprise: true })
    snapshot.data['money-honey-categories'] = JSON.stringify({
      version: 1,
      customCategories: [{ name: ' Boat ', type: 'income', extra: 1 }, { nope: true }],
      builtInNames: { 'expense:Groceries': 'Eats', 'made-up': 'x' },
      disabledBuiltIns: ['income:Paycheck', 'bogus']
    })
  })

  importBackup(text, storage)

  assert.deepEqual(JSON.parse(storage.getItem(THEME_STORAGE_KEY)), {
    themeId: 'mine', lineSpacing: 'normal', colors: { accent: '#fff' }
  })
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(CUSTOM_THEME_STORAGE_KEY))[0], 'extra'), false)
  assert.deepEqual(JSON.parse(storage.getItem('money-honey-budget-settings')), {
    mode: 'smart', period: 'monthly', historyMonths: 3, suggestionsEnabled: false, rolloverEnabled: false
  })
  assert.deepEqual(JSON.parse(storage.getItem('money-honey-categories')), {
    version: 1,
    customCategories: [{ name: 'Boat', type: 'income' }],
    builtInNames: { 'expense:Groceries': 'Eats' },
    disabledBuiltIns: ['income:Paycheck']
  })
})

test('a stale safety backup blocks the restore before any write', () => {
  const { storage, values } = withStorage(existingData)
  const { backup } = parseBackup(backupText(), storage)
  const fingerprint = getDataFingerprint(storage)
  storage.setItem('money-honey-payees', '{"version":1,"payees":["Changed Later"]}')
  const before = [...values.entries()]

  assert.throws(() => restoreBackup(backup, storage, { expectedFingerprint: fingerprint }), error => error.code === 'stale')
  assert.deepEqual([...values.entries()], before)
  restoreBackup(backup, storage, { expectedFingerprint: getDataFingerprint(storage) })
  assert.match(storage.getItem('money-honey-bills'), /Rent/)
})

test('rollback failure is flagged only when previous data could not be restored', () => {
  const failingOnce = withStorage(existingData)
  const { backup } = parseBackup(backupText(), failingOnce.storage)
  let writes = 0
  const recoverable = {
    ...failingOnce.storage,
    setItem(key, value) {
      if (++writes === 2) throw new Error('quota')
      failingOnce.storage.setItem(key, value)
    }
  }
  assert.throws(() => restoreBackup(backup, recoverable), error => error.rollbackFailed === false)

  const stuck = withStorage(existingData)
  const lossy = { ...stuck.storage, setItem() { throw new Error('disk full') }, removeItem() { throw new Error('disk full') } }
  assert.throws(() => restoreBackup(backup, lossy), error =>
    error.rollbackFailed === true && /could not confirm that your previous data was restored/.test(error.message))
})

test('the safety backup downloads current data under a distinct filename without changing storage', () => {
  const { storage, values } = withStorage(existingData)
  const before = [...values.entries()]
  const clicks = []
  const originalDocument = globalThis.document
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let blob
  globalThis.document = { createElement: () => ({ click() { clicks.push(this.download) } }) }
  URL.createObjectURL = value => { blob = value; return 'blob:test' }
  URL.revokeObjectURL = () => {}
  const date = new Date(2026, 10, 12, 9, 5, 7)

  try {
    const result = downloadSafetyBackup(storage, date)
    assert.equal(result.filename, 'money-honey-safety-backup-2026-11-12-090507.json')
    assert.equal(result.filename, getSafetyBackupFilename(date))
    assert.deepEqual(clicks, [result.filename])
    assert.equal(result.fingerprint, getDataFingerprint(storage))
    assert.notEqual(result.filename, getBackupFilename(date))
  } finally {
    globalThis.document = originalDocument
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
  return blob.text().then(text => {
    assert.deepEqual(JSON.parse(text).data['money-honey-payees'], existingData['money-honey-payees'])
    assert.equal(Object.hasOwn(JSON.parse(text).data, 'money-honey-pin'), false)
    assert.deepEqual([...values.entries()], before)
  })
})
