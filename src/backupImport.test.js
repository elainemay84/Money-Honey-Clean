import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const browser = new Window({ url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'HTMLElement', 'Node']) {
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
const { default: Backup } = await vite.ssrLoadModule('/src/Backup.jsx')
const { default: App } = await vite.ssrLoadModule('/src/App.jsx')
const { RESTORE_NOTICE_KEY } = await vite.ssrLoadModule('/src/backupRestoreNotice.js')
const { createBackupSnapshot } = await vite.ssrLoadModule('/src/backupData.js')

const ACCOUNT_KEY = 'money-honey-account-data'
const roots = []

function validBackupText() {
  const source = new Map([
    [ACCOUNT_KEY, JSON.stringify({ version: 1, accounts: [{ id: 1, name: 'Restored' }], transactions: [] })]
  ])
  const snapshot = createBackupSnapshot({ getItem: key => source.get(key) ?? null })
  return JSON.stringify(snapshot)
}

function fakeSafetyDownload(storage) {
  const calls = []
  const download = () => {
    calls.push('download')
    return {
      filename: 'money-honey-safety-backup-test.json',
      fingerprint: JSON.stringify(createBackupSnapshot(storage).data)
    }
  }
  return { calls, download }
}

async function render(props = {}, Component = Backup) {
  const container = browser.document.createElement('div')
  browser.document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  const calls = { reload: 0, home: 0 }
  await act(async () => root.render(React.createElement(Component, {
    onBack() {},
    onHome: () => { calls.home += 1 },
    reload: () => { calls.reload += 1 },
    storage: browser.localStorage,
    downloadSafety: fakeSafetyDownload(browser.localStorage).download,
    ...props
  })))
  return { container, calls }
}

async function chooseFile(container, text, name = 'backup.json') {
  const input = container.querySelector('#backup-file')
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name, size: text.length, text: async () => text }]
  })
  await act(async () => {
    input.dispatchEvent(new browser.Event('change', { bubbles: true }))
  })
}

function findButton(container, label) {
  return [...container.querySelectorAll('button')].find(item => item.textContent.includes(label))
}

async function acknowledge(container) {
  const checkbox = container.querySelector('input[type="checkbox"]')
  await act(async () => {
    checkbox.dispatchEvent(new browser.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function clickButton(container, label) {
  const button = findButton(container, label)
  assert.ok(button, `Expected a "${label}" button`)
  await act(async () => {
    button.dispatchEvent(new browser.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

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

const ORIGINAL = '{"version":1,"accounts":[{"id":9,"name":"Mine"}],"transactions":[]}'

function seedCurrentData() {
  browser.localStorage.setItem(ACCOUNT_KEY, ORIGINAL)
  browser.localStorage.setItem('money-honey-appearance-size', 'large')
}

async function prepareRestore(container) {
  await chooseFile(container, validBackupText())
  await clickButton(container, 'Download Current Backup')
  await acknowledge(container)
}

test('the compact preview summarizes the backup with one warning and collapsed details', async () => {
  seedCurrentData()
  const { container } = await render()

  await chooseFile(container, validBackupText(), 'my-backup.json')

  const preview = container.querySelector('[aria-label="Backup preview"]')
  assert.match(preview.textContent, /my-backup\.json/)
  assert.match(preview.textContent, /Exported/)
  assert.match(preview.textContent, /1 account, 0 transactions/)
  assert.equal(preview.textContent.match(/will replace your current Money Honey data/g).length, 1)
  assert.match(preview.textContent, /Anything not included in the backup may be removed\./)
  assert.match(preview.textContent, /I understand my current data will be replaced\./)
  assert.equal(container.querySelectorAll('h3').length, 0)

  const details = preview.querySelector('details')
  assert.equal(details.open, false)
  assert.match(details.querySelector('summary').textContent, /View details/)
  assert.match(details.querySelector('[data-action="replace"]').textContent, /Accounts & transactions.*Replaced/)
  assert.match(details.querySelector('[data-action="remove"]').textContent, /Text size.*Removed/)

  const restore = findButton(container, 'Restore Backup')
  assert.equal(restore.parentElement, findButton(container, 'Cancel').parentElement)
  assert.equal(browser.localStorage.getItem(ACCOUNT_KEY), ORIGINAL)
})

test('Restore stays disabled until a safety backup download starts and the replacement is acknowledged', async () => {
  seedCurrentData()
  const safety = fakeSafetyDownload(browser.localStorage)
  const { container } = await render({ downloadSafety: safety.download })

  await chooseFile(container, validBackupText())
  assert.equal(findButton(container, 'Restore Backup').disabled, true)

  await acknowledge(container)
  assert.equal(findButton(container, 'Restore Backup').disabled, true)

  await clickButton(container, 'Download Current Backup')
  assert.deepEqual(safety.calls, ['download'])
  assert.equal(findButton(container, 'Restore Backup').disabled, false)
  const notice = container.querySelector('[role="status"]').textContent
  assert.match(notice, /Download started: money-honey-safety-backup-test\.json/)
  assert.match(notice, /cannot confirm it was saved/)
  assert.doesNotMatch(notice, /saved successfully|has been saved/i)
})

test('Restore stays disabled when the safety backup download cannot be started', async () => {
  seedCurrentData()
  const { container } = await render({ downloadSafety() { throw new Error('blocked') } })

  await chooseFile(container, validBackupText())
  await clickButton(container, 'Download Current Backup')
  await acknowledge(container)

  assert.match(container.querySelector('[role="alert"]').textContent, /could not be started/)
  assert.equal(findButton(container, 'Restore Backup').disabled, true)
  assert.equal(browser.localStorage.getItem(ACCOUNT_KEY), ORIGINAL)
})

test('no safety backup is demanded when the device has no data', async () => {
  const { container } = await render()

  await chooseFile(container, validBackupText())
  await acknowledge(container)

  assert.equal(findButton(container, 'Download Current Backup'), undefined)
  assert.equal(findButton(container, 'Restore Backup').disabled, false)
})

test('cancelling the preview preserves current data and hides the confirmation', async () => {
  seedCurrentData()
  const { container, calls } = await render()

  await prepareRestore(container)
  await clickButton(container, 'Cancel')

  assert.equal(container.querySelector('[aria-label="Backup preview"]'), null)
  assert.equal(browser.localStorage.getItem(ACCOUNT_KEY), ORIGINAL)
  assert.equal(browser.localStorage.getItem('money-honey-appearance-size'), 'large')
  assert.equal(calls.reload, 0)
})

test('confirming restores verified data, flags the session, and reloads without showing a timed message', async () => {
  seedCurrentData()
  browser.localStorage.setItem('money-honey-pin', '1234')
  const { container, calls } = await render()

  await prepareRestore(container)
  await clickButton(container, 'Restore Backup')

  assert.match(browser.localStorage.getItem(ACCOUNT_KEY), /Restored/)
  assert.equal(browser.localStorage.getItem('money-honey-appearance-size'), null)
  assert.equal(browser.localStorage.getItem('money-honey-pin'), '1234')
  assert.equal(browser.sessionStorage.getItem(RESTORE_NOTICE_KEY), '1')
  assert.equal(calls.reload, 1)
  assert.match(container.querySelector('[role="status"]').textContent, /Backup Restored!/)
  assert.match(container.textContent, /Your Money Honey data has been restored successfully\./)
  assert.equal(calls.home, 0)
})

test('the success confirmation survives the reload and stays until dismissed', async () => {
  seedCurrentData()
  const first = await render()
  await prepareRestore(first.container)
  await clickButton(first.container, 'Restore Backup')

  // Simulate the reload: a brand-new mount in the same browser session.
  const { container, calls } = await render()

  const card = container.querySelector('[role="status"]')
  assert.match(card.textContent, /✓/)
  assert.match(card.querySelector('h2').textContent, /^Backup Restored!$/)
  assert.match(card.textContent, /Your Money Honey data has been restored successfully\./)
  assert.ok(findButton(container, 'Back to Home'))
  assert.equal(container.querySelector('#backup-file'), null)
  assert.equal(calls.reload, 0)
  assert.equal(calls.home, 0)
  assert.equal(browser.sessionStorage.getItem(RESTORE_NOTICE_KEY), '1')

  const again = await render()
  assert.match(again.container.textContent, /Backup Restored!/)
})

test('dismissing the confirmation goes home once and clears the session flag', async () => {
  browser.sessionStorage.setItem(RESTORE_NOTICE_KEY, '1')
  const { container, calls } = await render()

  await clickButton(container, 'Back to Home')

  assert.equal(calls.home, 1)
  assert.equal(calls.reload, 0)
  assert.equal(browser.sessionStorage.getItem(RESTORE_NOTICE_KEY), null)
  assert.doesNotMatch(container.textContent, /Backup Restored!/)
  const fresh = await render()
  assert.doesNotMatch(fresh.container.textContent, /Backup Restored!/)
})

test('without session storage the confirmation still shows and Back to Home reloads to finish syncing', async () => {
  seedCurrentData()
  const session = { getItem: () => null, setItem() { throw new Error('blocked') }, removeItem() {} }
  const { container, calls } = await render({ session })

  await prepareRestore(container)
  await clickButton(container, 'Restore Backup')

  assert.equal(calls.reload, 0)
  assert.match(container.textContent, /Backup Restored!/)
  await clickButton(container, 'Back to Home')
  assert.equal(calls.reload, 1)
  assert.equal(calls.home, 0)
})

test('the app reopens Backup & Transfer with the confirmation after a reload and keeps it until dismissed', async () => {
  browser.sessionStorage.setItem(RESTORE_NOTICE_KEY, '1')
  const { container } = await render({}, App)

  assert.match(container.textContent, /Backup & Transfer/)
  assert.match(container.textContent, /Backup Restored!/)
  assert.doesNotMatch(container.textContent, /Your financial snapshot/)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  assert.match(container.textContent, /Backup Restored!/)
  assert.equal(browser.sessionStorage.getItem(RESTORE_NOTICE_KEY), '1')

  await clickButton(container, 'Back to Home')

  assert.match(container.textContent, /Your financial snapshot/)
  assert.equal(browser.sessionStorage.getItem(RESTORE_NOTICE_KEY), null)
})

test('leaving the screen without tapping the button also clears the session flag', async () => {
  browser.sessionStorage.setItem(RESTORE_NOTICE_KEY, '1')
  const { container } = await render({}, App)

  await clickButton(container, 'Settings')

  assert.equal(browser.sessionStorage.getItem(RESTORE_NOTICE_KEY), null)
  assert.doesNotMatch(container.textContent, /Backup Restored!/)
})

test('an invalid or credential-bearing file shows an error and preserves data', async () => {
  seedCurrentData()
  const { container } = await render()

  await chooseFile(container, '{"formatVersion":1,"data":{"money-honey-account-data":"{oops"}}')
  assert.match(container.querySelector('[role="alert"]').textContent, /not valid JSON/)
  assert.equal(container.querySelector('[aria-label="Backup preview"]'), null)

  await chooseFile(container, JSON.stringify({ formatVersion: 1, data: { 'money-honey-pin': '1234' } }))
  assert.match(container.querySelector('[role="alert"]').textContent, /never imports PINs/)
  assert.equal(container.querySelector('[aria-label="Backup preview"]'), null)
  assert.equal(browser.localStorage.getItem(ACCOUNT_KEY), ORIGINAL)
})

test('a failed restore rolls back, reports the failure, and does not reload', async () => {
  seedCurrentData()
  let writes = 0
  const storage = {
    getItem: key => browser.localStorage.getItem(key),
    removeItem: key => browser.localStorage.removeItem(key),
    setItem(key, value) {
      if (++writes === 1) throw new Error('quota')
      browser.localStorage.setItem(key, value)
    }
  }
  const { container, calls } = await render({ storage, downloadSafety: fakeSafetyDownload(storage).download })

  await prepareRestore(container)
  await clickButton(container, 'Restore Backup')

  assert.match(container.querySelector('[role="alert"]').textContent, /existing data was kept unchanged/)
  assert.equal(container.querySelector('[aria-label="Recovery instructions"]'), null)
  assert.doesNotMatch(container.textContent, /Backup Restored!/)
  assert.equal(browser.sessionStorage.getItem(RESTORE_NOTICE_KEY), null)
  assert.equal(browser.localStorage.getItem(ACCOUNT_KEY), ORIGINAL)
  assert.equal(calls.reload, 0)
})

test('a failed rollback warns instead of claiming the old data was restored and gives recovery steps', async () => {
  seedCurrentData()
  const storage = {
    getItem: key => browser.localStorage.getItem(key),
    removeItem() { throw new Error('disk error') },
    setItem() { throw new Error('disk error') }
  }
  const { container, calls } = await render({ storage, downloadSafety: fakeSafetyDownload(storage).download })

  await prepareRestore(container)
  await clickButton(container, 'Restore Backup')

  const recovery = container.querySelector('[aria-label="Recovery instructions"]').textContent
  assert.match(recovery, /may not have been restored/)
  assert.match(recovery, /money-honey-safety-backup-test\.json/)
  assert.match(recovery, /choose that file under Import Backup/)
  assert.doesNotMatch(recovery, /kept unchanged/)
  assert.doesNotMatch(container.textContent, /Backup Restored!/)
  assert.equal(browser.sessionStorage.getItem(RESTORE_NOTICE_KEY), null)
  assert.equal(calls.reload, 0)
})

test('data changing after the safety backup blocks the restore without writing', async () => {
  seedCurrentData()
  const { container } = await render()

  await prepareRestore(container)
  browser.localStorage.setItem('money-honey-appearance-size', 'small')
  await clickButton(container, 'Restore Backup')

  assert.match(container.querySelector('[role="alert"]').textContent, /data changed/)
  assert.equal(browser.localStorage.getItem(ACCOUNT_KEY), ORIGINAL)
  assert.equal(browser.localStorage.getItem('money-honey-appearance-size'), 'small')
})

test('a restore whose written data does not verify shows an error and never the success confirmation', async () => {
  seedCurrentData()
  const storage = {
    getItem: key => browser.localStorage.getItem(key),
    removeItem: key => browser.localStorage.removeItem(key),
    setItem(key, value) {
      browser.localStorage.setItem(key, key === ACCOUNT_KEY && value.includes('Restored') ? 'truncated' : value)
    }
  }
  const { container, calls } = await render({ storage, downloadSafety: fakeSafetyDownload(storage).download })

  await prepareRestore(container)
  await clickButton(container, 'Restore Backup')

  assert.match(container.querySelector('[role="alert"]').textContent, /existing data was kept unchanged/)
  assert.doesNotMatch(container.textContent, /Backup Restored!/)
  assert.equal(browser.sessionStorage.getItem(RESTORE_NOTICE_KEY), null)
  assert.equal(browser.localStorage.getItem(ACCOUNT_KEY), ORIGINAL)
  assert.equal(calls.reload, 0)
})
