import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const browser = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'HTMLElement', 'HTMLInputElement', 'Node']) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? browser
      : key === 'document' ? browser.document
        : key === 'navigator' ? browser.navigator
          : key === 'localStorage' ? browser.localStorage
            : key === 'sessionStorage' ? browser.sessionStorage
              : browser[key]
  })
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const vite = await createServer({
  configFile: new URL('../vite.config.js', import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent'
})
const { default: DeleteConfirmation } = await vite.ssrLoadModule('/src/DeleteConfirmation.jsx')
const { default: App } = await vite.ssrLoadModule('/src/App.jsx')
const { performProfileAction, PENDING_OPERATION_STORAGE_KEY } = await vite.ssrLoadModule('/src/profileData.js')
const { PROFILE_NOTICE_KEY } = await vite.ssrLoadModule('/src/profileActionNotice.js')
const roots = []

function seedData() {
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    version: 1,
    accounts: [{ id: 1, name: 'Mine', type: 'Checking', openingBalance: 250 }],
    transactions: [{ id: 1, accountId: 1, name: 'Coffee', amount: -5, date: '2026-11-01' }]
  }))
  browser.localStorage.setItem('money-honey-bills', '{"version":1,"bills":[{"id":1,"name":"Rent","amount":900}],"incomes":[]}')
  browser.localStorage.setItem('money-honey-debts', '{"version":1,"debts":[]}')
  browser.localStorage.setItem('money-honey-manual-budgets', '{"budgets":{"Groceries":200}}')
  browser.localStorage.setItem('money-honey-payees', '{"version":1,"payees":["Keep Me"]}')
  browser.localStorage.setItem('money-honey-theme-settings', '{"themeId":"custom-1"}')
  browser.localStorage.setItem('unrelated-site-data', 'keep')
  browser.sessionStorage.setItem('unrelated', 'value')
}

function failingStorage({ failAt = 1, blockRollback = false } = {}) {
  let writes = 0
  return {
    getItem: key => browser.localStorage.getItem(key),
    setItem(key, value) {
      if (key !== PENDING_OPERATION_STORAGE_KEY && ++writes >= failAt && (writes === failAt || blockRollback)) throw new Error('quota')
      browser.localStorage.setItem(key, value)
    },
    removeItem(key) {
      if (key !== PENDING_OPERATION_STORAGE_KEY && blockRollback && writes >= failAt) throw new Error('quota')
      browser.localStorage.removeItem(key)
    }
  }
}

function storageSnapshot() {
  const read = storage => Object.fromEntries(Array.from({ length: storage.length }, (_, index) => storage.key(index)).map(key => [key, storage.getItem(key)]))
  return JSON.stringify([read(browser.localStorage), read(browser.sessionStorage)])
}

function codeSequence(...codes) {
  const queue = [...codes]
  return () => queue.shift()
}

async function render(Component, props = {}) {
  const container = browser.document.createElement('div')
  browser.document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  const calls = { back: 0, confirm: [], reload: 0, backups: 0 }
  await act(async () => root.render(React.createElement(Component, {
    onBack: () => { calls.back += 1 },
    onConfirm: kind => { calls.confirm.push(kind) },
    reload: () => { calls.reload += 1 },
    downloadBackup: () => { calls.backups += 1; return { filename: 'money-honey-safety-backup-test.json' } },
    ...props
  })))
  return { container, calls }
}

const findButton = (container, label) => [...container.querySelectorAll('button')].find(item => item.textContent.includes(label))

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new browser.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function type(container, value) {
  const input = container.querySelector('input')
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new browser.Event('input', { bubbles: true }))
  })
}

async function submit(container) {
  await act(async () => {
    container.querySelector('form').dispatchEvent(new browser.Event('submit', { bubbles: true, cancelable: true }))
  })
}

const displayedCode = container => container.querySelector('[aria-label="Confirmation code"]').textContent

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  browser.document.body.replaceChildren()
  browser.localStorage.clear()
  browser.sessionStorage.clear()
})

after(async () => {
  await vite.close()
  browser.happyDOM.abort()
})

test('Settings has no separate Delete Confirmation card, and keeps Reset App Data and Delete Profile', async () => {
  const { container } = await render(App)

  await click([...container.querySelectorAll('nav div')].find(item => item.textContent.includes('More')))
  await click(findButton(container, 'Settings'))

  assert.doesNotMatch(container.textContent, /Delete Confirmation|Security & PIN|reset PIN/)
  assert.doesNotMatch(container.textContent, /Coming Soon/)
  assert.ok(findButton(container, 'Reset App Data'))
  assert.ok(findButton(container, 'Delete Profile'))
  for (const title of ['Themes & Fonts', 'Categories & Payees', 'Backup & Transfer']) {
    assert.ok(findButton(container, title), title)
  }
})

for (const [button, action] of [['Reset App Data', 'Yes, Reset App Data'], ['Delete Profile', 'Yes, Delete Profile']]) {
  test(`${button} opened from Settings still requires a fresh code and a final confirmation`, async () => {
    const { container } = await render(App)
    await click([...container.querySelectorAll('nav div')].find(item => item.textContent.includes('More')))
    await click(findButton(container, 'Settings'))
    await click(findButton(container, button))

    const code = displayedCode(container)
    assert.match(code, /^\d{4}$/)
    assert.equal(findButton(container, 'Continue').disabled, true)
    assert.equal(findButton(container, action), undefined)
    await type(container, code)
    await click(findButton(container, 'Continue'))
    assert.ok(findButton(container, action))
    await click(findButton(container, 'Go Back'))
    await click(findButton(container, 'Cancel'))
    assert.ok(findButton(container, 'Reset App Data'))
  })
}

test('Reset App Data lists exactly what is removed and what stays, shows a code, and changes nothing on open', async () => {
  seedData()
  const before = storageSnapshot()
  const { container, calls } = await render(DeleteConfirmation, { kind: 'reset', generateCode: codeSequence('4821') })

  const text = container.textContent
  assert.match(text, /Will be removed/)
  for (const removed of ['transactions', 'bills and recurring income schedules', 'debts and debt payment history', 'budgets and budget spending data', 'paycheck forecast']) {
    assert.match(text, new RegExp(removed, 'i'))
  }
  assert.match(text, /Will stay/)
  assert.match(text, /accounts, with their names and types \(balances are reset to \$0\)/)
  assert.match(text, /Categories and saved payees/)
  assert.match(text, /Preset and custom themes, appearance, and other settings/)
  assert.equal(displayedCode(container), '4821')
  assert.equal(findButton(container, 'Continue').disabled, true)
  assert.equal(findButton(container, 'Yes, Reset App Data'), undefined)
  assert.equal(storageSnapshot(), before)
  assert.equal(storageSnapshot().includes('4821'), false)
  assert.deepEqual(calls.confirm, [])
})

test('Delete Profile explains it is local only and keeps downloaded backups', async () => {
  const { container } = await render(DeleteConfirmation, { kind: 'delete', generateCode: codeSequence('1357') })

  const text = container.textContent
  assert.match(text, /deletes the local Money Honey profile and data on this device/)
  assert.match(text, /downloaded backup files/i)
  assert.doesNotMatch(text, /GitHub|external account/i)
  assert.match(text, /custom themes and saved preferences/)

  await type(container, '1357')
  await click(findButton(container, 'Continue'))
  assert.ok(findButton(container, 'Yes, Delete Profile'))
  assert.equal(findButton(container, 'Yes, Reset App Data'), undefined)
})

test('incorrect or partial codes keep Continue disabled and cannot be submitted', async () => {
  const { container, calls } = await render(DeleteConfirmation, { kind: 'reset', generateCode: codeSequence('4821') })

  for (const attempt of ['4812', '482', '0000', 'abcd']) {
    await type(container, attempt)
    assert.equal(findButton(container, 'Continue').disabled, true, attempt)
    await submit(container)
    assert.equal(findButton(container, 'Yes, Reset App Data'), undefined, attempt)
  }
  await type(container, '48211')
  assert.equal(container.querySelector('input').value, '4821')
  assert.deepEqual(calls.confirm, [])
})

test('bypass attempts: forcing the disabled button or submitting a wrong code never reaches the action', async () => {
  seedData()
  const before = storageSnapshot()
  const { container, calls } = await render(DeleteConfirmation, {
    kind: 'reset',
    generateCode: codeSequence('4821'),
    onConfirm: kind => performProfileAction(kind, browser.localStorage)
  })

  await type(container, '1111')
  const button = findButton(container, 'Continue')
  button.removeAttribute('disabled')
  await click(button)
  await submit(container)

  assert.equal(findButton(container, 'Yes, Reset App Data'), undefined)
  assert.equal(calls.reload, 0)
  assert.equal(storageSnapshot(), before)
})

test('Download Backup is offered, starts a download, and never deletes anything', async () => {
  seedData()
  const before = storageSnapshot()
  const { container, calls } = await render(DeleteConfirmation, { kind: 'delete', generateCode: codeSequence('4821') })

  await click(findButton(container, 'Download Backup'))

  assert.equal(calls.backups, 1)
  const note = container.querySelector('[role="status"]').textContent
  assert.match(note, /Download started: money-honey-safety-backup-test\.json/)
  assert.match(note, /cannot confirm it was saved/)
  assert.deepEqual(calls.confirm, [])
  assert.equal(storageSnapshot(), before)

  await type(container, '4821')
  await click(findButton(container, 'Continue'))
  assert.ok(findButton(container, 'Download Backup'))
})

test('a failed backup download shows an error and does not block or trigger deletion', async () => {
  const { container, calls } = await render(DeleteConfirmation, {
    kind: 'reset',
    generateCode: codeSequence('4821'),
    downloadBackup: () => { throw new Error('blocked') }
  })

  await click(findButton(container, 'Download Backup'))

  assert.match(container.querySelector('[role="alert"] + * , p[role="alert"]').textContent, /could not be started/)
  assert.deepEqual(calls.confirm, [])
})

test('Reset App Data runs only after the code and final confirmation, then flags the session and reloads', async () => {
  seedData()
  const { container, calls } = await render(DeleteConfirmation, {
    kind: 'reset',
    generateCode: codeSequence('4821'),
    onConfirm: kind => performProfileAction(kind, browser.localStorage)
  })

  await type(container, '4821')
  const afterCode = storageSnapshot()
  await click(findButton(container, 'Continue'))
  assert.match(container.querySelector('[aria-label="Final confirmation"]').textContent, /Final confirmation/)
  assert.equal(storageSnapshot(), afterCode)
  assert.equal(calls.reload, 0)

  await click(findButton(container, 'Yes, Reset App Data'))

  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-account-data')).transactions.length, 0)
  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-account-data')).accounts[0].openingBalance, 0)
  assert.equal(browser.localStorage.getItem('money-honey-account-data').includes('"Mine"'), true)
  assert.equal(browser.localStorage.getItem('money-honey-manual-budgets'), null)
  assert.equal(browser.localStorage.getItem('money-honey-payees'), '{"version":1,"payees":["Keep Me"]}')
  assert.equal(browser.localStorage.getItem('money-honey-theme-settings'), '{"themeId":"custom-1"}')
  assert.equal(browser.localStorage.getItem('unrelated-site-data'), 'keep')
  assert.equal(browser.localStorage.getItem(PENDING_OPERATION_STORAGE_KEY), null)
  assert.equal(browser.sessionStorage.getItem(PROFILE_NOTICE_KEY), 'reset')
  assert.equal(calls.reload, 1)
  assert.match(container.querySelector('[role="status"]').textContent, /App Data Reset/)
})

test('Delete Profile removes the profile but not unrelated keys, then flags the session and reloads', async () => {
  seedData()
  const { container, calls } = await render(DeleteConfirmation, {
    kind: 'delete',
    generateCode: codeSequence('1357'),
    onConfirm: kind => performProfileAction(kind, browser.localStorage)
  })

  await type(container, '1357')
  await click(findButton(container, 'Continue'))
  await click(findButton(container, 'Yes, Delete Profile'))

  assert.equal(browser.localStorage.getItem('money-honey-payees'), null)
  assert.equal(browser.localStorage.getItem('money-honey-theme-settings'), null)
  assert.deepEqual(JSON.parse(browser.localStorage.getItem('money-honey-account-data')), { version: 1, accounts: [], transactions: [] })
  assert.equal(browser.localStorage.getItem('unrelated-site-data'), 'keep')
  assert.equal(browser.sessionStorage.getItem('unrelated'), 'value')
  assert.equal(browser.sessionStorage.getItem(PROFILE_NOTICE_KEY), 'delete')
  assert.equal(calls.reload, 1)
  assert.match(container.querySelector('[role="status"]').textContent, /Profile Deleted/)
})

test('the completion message survives the reload and is cleared when dismissed', async () => {
  browser.sessionStorage.setItem(PROFILE_NOTICE_KEY, 'reset')
  const { container, calls } = await render(DeleteConfirmation, { kind: 'reset' })

  assert.match(container.querySelector('[role="status"]').textContent, /App Data Reset/)
  assert.equal(container.querySelector('input'), null)
  assert.equal(calls.reload, 0)
  assert.equal(browser.sessionStorage.getItem(PROFILE_NOTICE_KEY), 'reset')

  await click(findButton(container, 'Back to Settings'))
  assert.equal(calls.back, 1)
  assert.equal(browser.sessionStorage.getItem(PROFILE_NOTICE_KEY), null)
})

test('the app reopens the matching screen after the reload and clears the flag when you leave', async () => {
  browser.sessionStorage.setItem(PROFILE_NOTICE_KEY, 'delete')
  const { container } = await render(App)

  assert.match(container.textContent, /Profile Deleted/)
  assert.doesNotMatch(container.textContent, /Your financial snapshot/)
  await click(findButton(container, 'Settings'))
  assert.equal(browser.sessionStorage.getItem(PROFILE_NOTICE_KEY), null)
})

test('a failed action shows an error, never the success screen, and leaves data unchanged', async () => {
  seedData()
  const before = storageSnapshot()
  const { container, calls } = await render(DeleteConfirmation, {
    kind: 'reset',
    generateCode: codeSequence('4821'),
    onConfirm: kind => performProfileAction(kind, failingStorage({ failAt: 2 }))
  })

  await type(container, '4821')
  await click(findButton(container, 'Continue'))
  await click(findButton(container, 'Yes, Reset App Data'))

  assert.match(container.querySelector('[role="alert"]').textContent, /Nothing was deleted and your data is unchanged/)
  assert.equal(container.querySelector('[role="status"]'), null)
  assert.doesNotMatch(container.textContent, /App Data Reset|Profile Deleted/)
  assert.equal(browser.sessionStorage.getItem(PROFILE_NOTICE_KEY), null)
  assert.equal(calls.reload, 0)
  assert.equal(storageSnapshot(), before)
})

test('a failed rollback warns and gives recovery steps instead of claiming data is unchanged', async () => {
  seedData()
  const { container, calls } = await render(DeleteConfirmation, {
    kind: 'delete',
    generateCode: codeSequence('1357'),
    onConfirm: kind => performProfileAction(kind, failingStorage({ failAt: 2, blockRollback: true }))
  })

  await click(findButton(container, 'Download Backup'))
  await type(container, '1357')
  await click(findButton(container, 'Continue'))
  await click(findButton(container, 'Yes, Delete Profile'))

  const recovery = container.querySelector('[aria-label="Recovery instructions"]').textContent
  assert.match(recovery, /some of your data may have been changed or removed/i)
  assert.match(recovery, /money-honey-safety-backup-test\.json/)
  assert.match(recovery, /Import Backup/)
  assert.doesNotMatch(recovery, /unchanged/)
  assert.doesNotMatch(container.textContent, /Profile Deleted/)
  assert.equal(browser.sessionStorage.getItem(PROFILE_NOTICE_KEY), null)
  assert.equal(calls.reload, 0)
  assert.notEqual(browser.localStorage.getItem(PENDING_OPERATION_STORAGE_KEY), null)
})

test('cancelling at either step leaves data untouched and never confirms', async () => {
  seedData()
  const before = storageSnapshot()
  const first = await render(DeleteConfirmation, { kind: 'reset', generateCode: codeSequence('4821') })
  await type(first.container, '4821')
  await click(findButton(first.container, 'Cancel'))
  assert.equal(first.calls.back, 1)

  const second = await render(DeleteConfirmation, { kind: 'delete', generateCode: codeSequence('1357', '2468') })
  await type(second.container, '1357')
  await click(findButton(second.container, 'Continue'))
  await click(findButton(second.container, 'Go Back'))
  await click(findButton(second.container, 'Cancel'))
  assert.equal(second.calls.back, 1)

  assert.deepEqual([...first.calls.confirm, ...second.calls.confirm], [])
  assert.equal(first.calls.reload + second.calls.reload, 0)
  assert.equal(storageSnapshot(), before)
})

test('each attempt gets a fresh code and an old code no longer works', async () => {
  const { container, calls } = await render(DeleteConfirmation, { kind: 'reset', generateCode: codeSequence('4821', '9034') })

  await type(container, '4821')
  await click(findButton(container, 'Continue'))
  await click(findButton(container, 'Go Back'))

  assert.equal(displayedCode(container), '9034')
  assert.equal(container.querySelector('input').value, '')
  await type(container, '4821')
  assert.equal(findButton(container, 'Continue').disabled, true)
  await submit(container)
  assert.equal(findButton(container, 'Yes, Reset App Data'), undefined)
  assert.deepEqual(calls.confirm, [])
})

test('reopening the screen from Settings generates a new code each time and stores none', async () => {
  const { container } = await render(App)
  await click([...container.querySelectorAll('nav div')].find(item => item.textContent.includes('More')))
  await click(findButton(container, 'Settings'))

  const seen = []
  for (let index = 0; index < 3; index += 1) {
    await click(findButton(container, 'Reset App Data'))
    seen.push(displayedCode(container))
    assert.match(seen.at(-1), /^\d{4}$/)
    await click(findButton(container, 'Cancel'))
  }
  assert.equal(seen.some(code => storageSnapshot().includes(`"${code}"`)), false)
})

test('a device that cannot create a code blocks the action instead of skipping the check', async () => {
  const { container, calls } = await render(DeleteConfirmation, { kind: 'delete', generateCode: () => { throw new Error('no crypto') } })

  assert.match(container.querySelector('[role="alert"]').textContent, /could not be created/)
  assert.equal(container.querySelector('input'), null)
  assert.equal(findButton(container, 'Continue'), undefined)
  assert.deepEqual(calls.confirm, [])
})

test('an interrupted earlier operation is reported on launch until dismissed', async () => {
  browser.localStorage.setItem(PENDING_OPERATION_STORAGE_KEY, JSON.stringify({ kind: 'reset', startedAt: '2026-11-12T00:00:00.000Z' }))
  const { container } = await render(App)

  const notice = container.querySelector('[aria-label="Interrupted operation"]')
  assert.match(notice.textContent, /Reset App Data did not finish/)
  assert.match(notice.textContent, /Backup & Transfer/)

  await click(findButton(container, 'Dismiss'))
  assert.equal(container.querySelector('[aria-label="Interrupted operation"]'), null)
  assert.equal(browser.localStorage.getItem(PENDING_OPERATION_STORAGE_KEY), null)
})

test('no interruption notice appears in normal use', async () => {
  const { container } = await render(App)
  assert.equal(container.querySelector('[aria-label="Interrupted operation"]'), null)
})

test('the app still opens every page after Delete Profile, without bringing demo data back', async () => {
  seedData()
  performProfileAction('delete', browser.localStorage)
  const { container } = await render(App)

  for (const page of ['Accounts', 'Bills', 'Budgets', 'Debt', 'Home']) {
    await click([...container.querySelectorAll('nav div')].find(item => item.textContent.trim().endsWith(page)))
    assert.doesNotMatch(container.textContent, /Everyday Checking|Mortgage|Discover Card|Electric/, page)
  }
  assert.deepEqual(JSON.parse(browser.localStorage.getItem('money-honey-account-data')), { version: 1, accounts: [], transactions: [] })
  assert.deepEqual(JSON.parse(browser.localStorage.getItem('money-honey-bills')), { version: 1, bills: [], incomes: [] })
})

test('the app opens every page after Reset App Data with accounts kept and no leftovers', async () => {
  seedData()
  performProfileAction('reset', browser.localStorage)
  const { container } = await render(App)

  await click([...container.querySelectorAll('nav div')].find(item => item.textContent.trim().endsWith('Accounts')))
  assert.match(container.textContent, /Mine/)
  assert.doesNotMatch(container.textContent, /Coffee/)
  for (const page of ['Bills', 'Budgets', 'Debt', 'Home']) {
    await click([...container.querySelectorAll('nav div')].find(item => item.textContent.trim().endsWith(page)))
    assert.doesNotMatch(container.textContent, /Rent|Mortgage|Groceries \$200/, page)
  }
})

test('Reset App Data and Delete Profile headers use the full-title layout with the complete title', async () => {
  for (const [kind, title] of [['reset', 'Reset App Data'], ['delete', 'Delete Profile']]) {
    const { container } = await render(DeleteConfirmation, { kind, generateCode: codeSequence('4821') })
    const header = container.querySelector('.page-header')
    assert.ok(header.classList.contains('page-header-full-title'))
    assert.equal(header.querySelector('h1').textContent, title)
    assert.match(header.querySelector('.page-back').textContent, /Settings/)
  }
})
