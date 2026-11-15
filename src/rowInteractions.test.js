import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'
import { getReliableOcrLines, parseDebtStatement } from './statementData.js'
import { homeDepotOcrData } from './statementOcrFixture.js'
import { createDebtPayment, loadDebts, saveDebts, synchronizeDebtBills } from './debtData.js'

const browser = new Window({ url: 'http://localhost/' })
for (const key of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
  'HTMLElement',
  'Node'
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === 'window' ? browser
      : key === 'document' ? browser.document
        : key === 'navigator' ? browser.navigator
          : key === 'localStorage' ? browser.localStorage
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
const [{ default: Bills }, { default: Accounts }, { default: Debt }, { default: App }, { default: Settings }] = await Promise.all([
  vite.ssrLoadModule('/src/Bills.jsx'),
  vite.ssrLoadModule('/src/Accounts.jsx'),
  vite.ssrLoadModule('/src/Debt.jsx'),
  vite.ssrLoadModule('/src/App.jsx'),
  vite.ssrLoadModule('/src/Settings.jsx')
])
const roots = new Set()
const rootContainers = new Map()

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

function nextMonthlyDate(date) {
  const anchor = new Date(`${date}T00:00:00Z`)
  const year = anchor.getUTCFullYear()
  const month = anchor.getUTCMonth() + 1
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(anchor.getUTCDate(), lastDay)))
    .toISOString()
    .slice(0, 10)
}

function displayDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

function seedData({ recurring = false, recurringIncome = false } = {}) {
  const date = localDate()
  browser.localStorage.clear()
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    version: 1,
    accounts: [{
      id: 1,
      name: 'Checking',
      type: 'Checking',
      openingBalance: 1000,
      openingDate: date,
      defaultCleared: false,
      archived: false
    }],
    transactions: []
  }))
  browser.localStorage.setItem('money-honey-bills', JSON.stringify({
    version: 1,
    bills: [{
      id: 1,
      name: recurring ? 'Repeating' : 'Electric',
      amount: 80,
      dueDate: date,
      frequency: recurring ? 'monthly' : 'one-time',
      autopay: false,
      accountId: 1,
      paymentHistory: []
    }],
    incomes: [{
      id: 2,
      name: 'Paycheck',
      amount: 1200,
      dueDate: date,
      frequency: recurringIncome ? 'monthly' : 'one-time',
      accountId: 1,
      active: true,
      archived: false,
      paymentHistory: []
    }]
  }))
  browser.localStorage.removeItem('money-honey-transaction-sort')
}

async function render(Component) {
  const container = browser.document.createElement('div')
  browser.document.body.append(container)
  const root = createRoot(container)
  roots.add(root)
  rootContainers.set(container, root)
  await act(async () => root.render(React.createElement(Component)))
  return container
}

async function reload(Component, container) {
  const root = rootContainers.get(container)
  assert.ok(root, 'Expected rendered component root')
  await act(async () => root.unmount())
  roots.delete(root)
  rootContainers.delete(container)
  container.remove()
  return render(Component)
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new browser.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function changeValue(element, value) {
  await act(async () => {
    const prototype = element instanceof browser.HTMLSelectElement
      ? browser.HTMLSelectElement.prototype
      : browser.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new browser.Event('input', { bubbles: true }))
    element.dispatchEvent(new browser.Event('change', { bubbles: true }))
  })
}

async function submit(form) {
  await act(async () => {
    form.dispatchEvent(new browser.Event('submit', { bubbles: true, cancelable: true }))
  })
}

function button(container, label) {
  const found = [...container.querySelectorAll('button')].find(item =>
    item.getAttribute('aria-label') === label || item.textContent.trim() === label
  )
  assert.ok(found, `Expected button "${label}"`)
  return found
}

function buttonContaining(container, label) {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent.includes(label))
  assert.ok(found, `Expected button containing "${label}"`)
  return found
}

function readAccountData() {
  return JSON.parse(browser.localStorage.getItem('money-honey-account-data'))
}

async function chooseStatementFile(container, label, name = 'statement.png', type = 'image/png') {
  const input = container.querySelector(`[aria-label="${label}"]`)
  Object.defineProperty(input, 'files', { configurable: true, value: [new browser.File(['synthetic test document'], name, { type })] })
  await act(async () => input.dispatchEvent(new browser.Event('change', { bubbles: true })))
}

async function openManualDebt(container) {
  await click(button(container, 'Add debt'))
  await click(button(container, 'Add Manually'))
}

test('Debt floating menu toggles, dismisses outside or with Escape, and never opens a choice dialog or saves data', async () => {
  const container = await render(Debt)
  const before = ['money-honey-debts', 'money-honey-account-data', 'money-honey-bills'].map(key => browser.localStorage.getItem(key))
  const trigger = button(container, 'Add debt')
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(container.querySelector('#debt-add-actions'), null)
  await click(trigger)
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  assert.equal(trigger.getAttribute('aria-controls'), 'debt-add-actions')
  assert.equal(container.querySelector('[role="dialog"]'), null)
  assert.deepEqual([...container.querySelectorAll('#debt-add-actions button')].map(item => item.textContent.trim()), ['Add Manually', 'Scan / Upload'])
  await click(button(container, 'Close add debt menu'))
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(container.querySelector('#debt-add-actions'), null)
  await click(trigger)
  await act(async () => container.querySelector('h1').dispatchEvent(new browser.Event('pointerdown', { bubbles: true })))
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  await click(trigger)
  await act(async () => browser.document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(browser.document.activeElement, trigger)
  assert.deepEqual(['money-honey-debts', 'money-honey-account-data', 'money-honey-bills'].map(key => browser.localStorage.getItem(key)), before)
})

test('floating actions open the existing forms directly and stay closed after forms or scanning close', async () => {
  const container = await render(Debt)
  await openManualDebt(container)
  assert.ok(container.querySelector('[aria-label="Add debt form"] form'))
  assert.equal(container.querySelector('[aria-label="Statement autofill"]'), null)
  assert.equal(container.querySelector('#debt-add-actions'), null)
  await click(button(container.querySelector('form'), 'Cancel'))
  assert.equal(button(container, 'Add debt').getAttribute('aria-expanded'), 'false')
  await click(button(container, 'Add debt'))
  await click(button(container, 'Scan / Upload'))
  assert.ok(container.querySelector('[role="dialog"][aria-labelledby="statement-scan-title"]'))
  assert.equal(container.querySelector('#debt-add-actions'), null)
  await click(button(container, 'Cancel'))
  assert.equal(container.querySelector('[role="dialog"]'), null)
  assert.equal(button(container, 'Add debt').getAttribute('aria-expanded'), 'false')
})

test('compact scanner has labeled upload rows, concise copy and accessible keyboard dismissal', async () => {
  const container = await render(Debt)
  await click(button(container, 'Add debt'))
  await click(button(container, 'Scan / Upload'))
  const dialog = container.querySelector('.statement-scan-dialog')
  assert.equal(dialog.getAttribute('aria-modal'), 'true')
  assert.equal(dialog.querySelector('h2').textContent.trim(), 'Scan Statement')
  assert.equal(dialog.querySelector(`#${dialog.getAttribute('aria-describedby')}`).textContent.trim(), 'Add a photo or PDF to fill in your debt details.')
  assert.equal(dialog.querySelector('.statement-scan-privacy').textContent, 'Processed privately on your device · 15 MB max')
  assert.doesNotMatch(dialog.textContent, /English summary|5 PDF pages|nothing is saved automatically/i)
  const before = browser.localStorage.getItem('money-honey-debts')
  for (const [label, inputLabel] of [
    ['Take Photo', 'Statement camera photo'], ['Choose Image', 'Statement image'], ['Choose PDF', 'Statement PDF']
  ]) {
    const action = button(dialog, label)
    assert.ok(action.classList.contains('statement-scan-choice'))
    assert.equal(action.querySelectorAll('svg[aria-hidden="true"]').length, 2)
    let clicked = false
    dialog.querySelector(`[aria-label="${inputLabel}"]`).addEventListener('click', () => { clicked = true })
    await click(action)
    assert.equal(clicked, true)
  }
  assert.equal(browser.localStorage.getItem('money-honey-debts'), before)
  const camera = button(dialog, 'Take Photo')
  const cancel = button(dialog, 'Cancel')
  await act(async () => camera.focus())
  await act(async () => document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
  assert.equal(document.activeElement, cancel)
  await act(async () => document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  assert.equal(document.activeElement, camera)
  await act(async () => document.dispatchEvent(new browser.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  assert.equal(container.querySelector('.statement-scan-dialog'), null)
  assert.equal(document.activeElement, button(container, 'Add debt'))
})

test('navigating away from Debt discards an expanded floating menu', async () => {
  const container = await render(App)
  const nav = container.querySelector('nav')
  await click(nav.children[4])
  await click(button(container, 'Add debt'))
  assert.ok(container.querySelector('#debt-add-actions'))
  await click(nav.children[0])
  assert.equal(container.querySelector('.debt-fab'), null)
  await click(nav.children[4])
  assert.equal(container.querySelector('#debt-add-actions'), null)
  assert.equal(button(container, 'Add debt').getAttribute('aria-expanded'), 'false')
})

test('Debt floating scan action opens the existing scanner and extracted suggestions open the unsaved normal form', async () => {
  let scannedFile
  const Component = () => React.createElement(Debt, {
    statementExtractor: async file => {
      scannedFile = file
      return parseDebtStatement([
        'Creditor: Example Bank', 'Credit Card Statement', 'Account ending in 0012',
        'Current Balance: $800.15', 'Minimum Payment Due: $25.50'
      ])
    }
  })
  const container = await render(Component)
  const before = ['money-honey-debts', 'money-honey-account-data', 'money-honey-bills'].map(key => browser.localStorage.getItem(key))
  assert.equal(container.querySelector('[aria-label="Statement autofill"]'), null)
  await click(button(container, 'Add debt'))
  assert.equal(container.querySelector('form'), null)
  assert.equal(container.querySelector('[role="dialog"]'), null)
  assert.ok(button(container, 'Add Manually'))
  await click(button(container, 'Scan / Upload'))
  assert.equal(container.querySelector('#debt-add-actions'), null)
  assert.equal(container.querySelector('[aria-label="Statement camera photo"]').getAttribute('capture'), 'environment')
  assert.equal(container.querySelector('[aria-label="Statement image"]').hasAttribute('capture'), false)
  assert.match(container.querySelector('[aria-label="Statement PDF"]').accept, /application\/pdf/)
  await chooseStatementFile(container, 'Statement image')
  const form = container.querySelector('form')
  assert.equal(button(container, 'Add debt').getAttribute('aria-expanded'), 'false')
  assert.equal(scannedFile.name, 'statement.png')
  assert.equal(form.querySelector('[aria-label="Debt name"]').value, 'Example Bank')
  assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').value, '800.15')
  assert.match(form.textContent, /Statement scanned\. Review your information before saving\./)
  assert.doesNotMatch(form.textContent, /Not determined:/)
  assert.equal(form.querySelector('[aria-label="Statement autofill"]'), null)
  await changeValue(form.querySelector('[aria-label="Current balance · amount still owed"]'), '912.34')
  assert.equal(form.querySelector('[aria-label="Debt name"]').value, 'Example Bank')
  assert.equal(form.querySelector('[aria-label="Account Last 4 Digits"]').value, '0012')
  assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').value, '912.34')
  assert.equal(form.querySelector('[aria-label="Minimum payment · amount due each cycle (optional)"]').value, '25.5')
  assert.equal(form.querySelector('[aria-label="Credit Limit"]').value, '')
  assert.equal(form.querySelector('[aria-label="Assigned To"]').value, '')
  assert.deepEqual(['money-honey-debts', 'money-honey-account-data', 'money-honey-bills'].map(key => browser.localStorage.getItem(key)), before)
})

test('editing a scanned debt requires overwrite approval and preserves payoff history and assignments', async () => {
  const debt = {
    id: 8, name: 'Existing card', type: 'Credit Card', startingBalance: 2000, currentBalance: 800,
    creditLimit: 5000, assignedTo: 'Joint', accountLast4: '0042',
    paymentHistory: [{ id: 'old-payment', total: 1200, principal: 1200, date: localDate() }]
  }
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({ version: 1, debts: [debt] }))
  const Component = () => React.createElement(Debt, {
    statementExtractor: async () => parseDebtStatement(['Creditor: Detected Bank', 'Current Balance: $900.25', 'Credit Limit: $6,000'])
  })
  const container = await render(Component)
  await click(container.querySelector('[aria-label="Debt row: Existing card"]'))
  await click(button(container, 'Edit Debt'))
  const before = browser.localStorage.getItem('money-honey-debts')
  const accountsBefore = browser.localStorage.getItem('money-honey-account-data')
  await click(button(container, 'Scan / Upload Statement'))
  await chooseStatementFile(container, 'Statement PDF', 'statement.pdf', 'application/pdf')
  const form = container.querySelector('form')
  await click(form.querySelector('[aria-label="Use Creditor / Debt Name"]'))
  let confirmation = ''
  browser.confirm = message => { confirmation = message; return false }
  await click(button(form, 'Apply Suggestions to Form'))
  assert.match(confirmation, /Credit Limit, Current Balance/)
  assert.doesNotMatch(confirmation, /Creditor/)
  assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').value, '800')
  assert.ok(form.querySelector('[aria-label="Review statement suggestions"]'))
  browser.confirm = () => true
  await click(button(form, 'Apply Suggestions to Form'))
  assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').value, '900.25')
  assert.equal(form.querySelector('[aria-label="Credit Limit"]').value, '6000')
  assert.equal(form.querySelector('[aria-label="Debt name"]').value, 'Existing card')
  assert.equal(browser.localStorage.getItem('money-honey-debts'), before)
  await submit(form)
  const saved = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(saved.startingBalance, 2000)
  assert.deepEqual(saved.paymentHistory, debt.paymentHistory)
  assert.equal(saved.assignedTo, 'Joint')
  assert.equal(saved.accountLast4, '0042')
  assert.equal(saved.currentBalance, 900.25)
  assert.equal(browser.localStorage.getItem('money-honey-account-data'), accountsBefore)
})

test('cancelled scans ignore late results and unsupported files show an error without changing the draft', async () => {
  let finish
  let scanSignal
  const Component = () => React.createElement(Debt, {
    statementExtractor: (file, { signal, onProgress }) => {
      scanSignal = signal
      onProgress('Reading image on your device...')
      return new Promise(resolve => { finish = resolve })
    }
  })
  let container = await render(Component)
  await click(button(container, 'Add debt'))
  await click(button(container, 'Scan / Upload'))
  await chooseStatementFile(container, 'Statement image')
  assert.match(container.querySelector('[role="status"]').textContent, /Reading image on your device/)
  assert.equal(button(container, 'Take Photo').disabled, true)
  assert.equal(button(container, 'Enter Manually').disabled, false)
  await click(button(container, 'Cancel Reading'))
  assert.equal(scanSignal.aborted, true)
  await openManualDebt(container)
  assert.equal(container.querySelector('[aria-label="Statement autofill"]'), null)
  await changeValue(container.querySelector('[aria-label="Debt name"]'), 'Manual draft')
  await act(async () => finish(parseDebtStatement(['Creditor: Late Bank'])))
  assert.equal(container.querySelector('[aria-label="Debt name"]').value, 'Manual draft')
  assert.equal(container.querySelector('[aria-label="Review statement suggestions"]'), null)
  container = await render(Debt)
  await click(button(container, 'Add debt'))
  await click(button(container, 'Scan / Upload'))
  await chooseStatementFile(container, 'Statement PDF', 'unsupported.txt', 'text/plain')
  assert.match(container.querySelector('[role="alert"]').textContent, /Unsupported file/)
  assert.doesNotMatch(container.textContent, /Not determined:/)
  assert.equal(container.querySelector('form'), null)
  assert.ok(button(container, 'Retry Reading'))
  await click(button(container, 'Enter Manually'))
  assert.equal(container.querySelector('[aria-label="Debt name"]').value, '')
})

test('a failed scanner can retry or return to manual entry without saving a debt', async () => {
  let attempts = 0
  const container = await render(() => React.createElement(Debt, {
    statementExtractor: async () => {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error('Reader initialization failed: local assets unavailable.'), { name: 'StatementScanError' })
      return parseDebtStatement(['Creditor: Recovered Bank', 'Current Balance: $123.45'])
    }
  }))
  const before = browser.localStorage.getItem('money-honey-debts')
  await click(button(container, 'Add debt'))
  await click(button(container, 'Scan / Upload'))
  await chooseStatementFile(container, 'Statement image')
  assert.match(container.querySelector('[role="alert"]').textContent, /initialization failed/)
  assert.ok(button(container, 'Enter Manually'))
  await click(button(container, 'Retry Reading'))
  assert.equal(attempts, 2)
  assert.equal(container.querySelector('[aria-label="Debt name"]').value, 'Recovered Bank')
  assert.equal(container.querySelector('[aria-label="Current balance · amount still owed"]').value, '123.45')
  assert.equal(browser.localStorage.getItem('money-honey-debts'), before)
})

test('one-field and two-field scans fill the normal Add Debt form while uncertain fields stay blank', async () => {
  for (const [lines, balance, apr, date] of [
    [['APR: 24.99%'], '', '24.99', ''],
    [['Current remaining balance', '$296.74', 'Next payment date', 'November 16, 2026'], '296.74', '', '2026-11-16']
  ]) {
    const container = await render(() => React.createElement(Debt, {
      statementExtractor: async () => parseDebtStatement(lines)
    }))
    const before = ['money-honey-debts', 'money-honey-bills', 'money-honey-account-data'].map(key => browser.localStorage.getItem(key))
    await click(button(container, 'Add debt'))
    await click(button(container, 'Scan / Upload'))
    await chooseStatementFile(container, 'Statement image')
    const form = container.querySelector('form')
    assert.ok(form)
    assert.match(form.textContent, /Statement scanned\. Review your information before saving\./)
    assert.equal(form.querySelector('[aria-label="Debt name"]').value, '')
    assert.equal(form.querySelector('[aria-label="Debt type"]').value, '')
    assert.equal(form.querySelector('[aria-label="Account Last 4 Digits"]').value, '')
    assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').value, balance)
    assert.equal(form.querySelector('[aria-label="Interest rate · annual percentage (optional)"]').value, apr)
    assert.equal(form.querySelector('[aria-label="Next Payment Due"]').value, date)
    assert.equal(form.querySelector('[aria-label="Minimum payment · amount due each cycle (optional)"]').value, '')
    assert.deepEqual([...form.querySelector('[aria-label="Payment Schedule"]').options].map(option => option.value), ['monthly', 'pay-in-4'])
    assert.equal(form.querySelector('[role="alert"]'), null)
    assert.doesNotMatch(form.textContent, /Not determined|Total Installments|Original Purchase/)
    await changeValue(form.querySelector('[aria-label="Debt name"]'), 'Manually completed name')
    assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').value, balance)
    assert.deepEqual(['money-honey-debts', 'money-honey-bills', 'money-honey-account-data'].map(key => browser.localStorage.getItem(key)), before)
    await click(button(form, 'Cancel'))
  }
})

test('failed and partial scans preserve manual debt edits, allow typing while reading and never save automatically', async () => {
  const debt = { id: 8, name: 'Existing card', type: 'Credit Card', startingBalance: 2000, currentBalance: 800, creditLimit: 5000, paymentHistory: [] }
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({ version: 1, debts: [debt] }))
  let rejectReading
  let attempts = 0
  const container = await render(() => React.createElement(Debt, {
    statementExtractor: async (file, { onProgress }) => {
      attempts += 1
      if (attempts > 1) return parseDebtStatement(['Next payment date: November 16, 2026'])
      onProgress('Reading text on your device... 50%')
      return new Promise((resolve, reject) => { rejectReading = reject })
    }
  }))
  await click(container.querySelector('[aria-label="Debt row: Existing card"]'))
  await click(button(container, 'Edit Debt'))
  const form = container.querySelector('form')
  const before = ['money-honey-debts', 'money-honey-bills', 'money-honey-account-data'].map(key => browser.localStorage.getItem(key))
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'My manual name')
  await changeValue(form.querySelector('[aria-label="Credit Limit"]'), '6000.50')
  await click(button(form, 'Scan / Upload Statement'))
  await chooseStatementFile(container, 'Statement image')
  assert.match(form.textContent, /Reading text on your device/)
  await changeValue(form.querySelector('[aria-label="Interest rate · annual percentage (optional)"]'), '18.50')
  await changeValue(form.querySelector('[aria-label="Current balance · amount still owed"]'), '734.56')
  await act(async () => rejectReading(Object.assign(new Error('We read text, but could not identify debt fields. Try the summary page or enter them manually.'), { name: 'StatementScanError' })))
  assert.match(form.querySelector('[role="alert"]').textContent, /could not identify debt fields/)
  assert.doesNotMatch(form.textContent, /Not determined:/)
  await click(button(form, 'Retry Reading'))
  assert.match(form.textContent, /We found 1 field/)
  assert.equal(form.querySelectorAll('[aria-label^="Scanned "]').length, 1)
  await click(button(form, 'Apply Suggestions to Form'))
  assert.equal(form.querySelector('[aria-label="Debt name"]').value, 'My manual name')
  assert.equal(form.querySelector('[aria-label="Credit Limit"]').value, '6000.50')
  assert.equal(form.querySelector('[aria-label="Interest rate · annual percentage (optional)"]').value, '18.50')
  assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').value, '734.56')
  assert.equal(form.querySelector('[aria-label="Next Payment Due"]').value, '2026-11-16')
  assert.match(form.textContent, /Statement scanned\. Review your information before saving\./)
  assert.deepEqual(['money-honey-debts', 'money-honey-bills', 'money-honey-account-data'].map(key => browser.localStorage.getItem(key)), before)
})

test('statement scans keep reference amounts without exposing advanced fields or choosing a complex schedule', async () => {
  const container = await render(() => React.createElement(Debt, { statementExtractor: async () => parseDebtStatement([
    'The Home Depot', 'Purchase date', 'May 15, 2026',
    'Purchase amount', '$1,568.00', 'Total interest', '$121.90',
    'APR', '24.99%', 'Total repayment amount', '$1,780.64', 'Amount already paid', '$1,483.90',
    'Current remaining balance', '$296.74', '5 of 6 payments completed',
    'Next scheduled payment', '$296.74', 'Next payment date', 'November 16, 2026'
  ]) }))
  await click(button(container, 'Add debt'))
  await click(button(container, 'Scan / Upload'))
  await chooseStatementFile(container, 'Statement PDF', 'installment.pdf', 'application/pdf')
  const form = container.querySelector('form')
  assert.match(form.textContent, /Statement scanned\. Review your information before saving\./)
  assert.doesNotMatch(form.textContent, /statement totals differ|Developer|confidence/i)
  assert.equal(form.querySelector('[aria-label="Debt type"]').value, 'Other')
  assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').value, '296.74')
  assert.equal(form.querySelector('[aria-label="Minimum payment · amount due each cycle (optional)"]').value, '296.74')
  for (const label of ['Original Purchase Amount', 'Original Total Repayment', 'Amount Already Paid', 'Total Installments', 'Completed Installments']) {
    assert.equal(form.querySelector(`[aria-label="${label}"]`), null)
  }
  assert.equal(form.querySelector('[aria-label="Payment Schedule"]').value, 'monthly')
  assert.equal(form.querySelector('[aria-label="Next Payment Due"]').value, '2026-11-16')
  assert.equal(form.querySelector('[aria-label="Starting balance · original amount borrowed or owed"]').value, '1568')
  await changeValue(form.querySelector('[aria-label="Starting balance · original amount borrowed or owed"]'), '1780.64')
  await changeValue(form.querySelector('[aria-label="Assigned To"]'), 'Joint')
  await submit(form)
  const saved = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.deepEqual(saved.paymentHistory, [])
  assert.equal(saved.currentBalance, 296.74)
  assert.equal(saved.startingBalance, 1780.64)
  assert.equal(saved.assignedTo, 'Joint')
  assert.equal(saved.creditLimit, null)
  assert.deepEqual(saved.statementDetails, { purchaseAmount: 1568, totalRepayment: 1780.64, totalInterest: 121.90, amountAlreadyPaid: 1483.9, nextPaymentAmount: 296.74 })
  assert.equal(saved.paymentSchedule.kind, 'monthly')
  assert.equal(saved.paymentSchedule.completedInstallments, 0)
  const bills = JSON.parse(browser.localStorage.getItem('money-honey-bills')).bills.filter(item => item.debtId === saved.id)
  assert.equal(bills.length, 1)
  assert.equal(bills[0].amount, 296.74)
  assert.deepEqual(bills[0].paymentHistory, [])
  assert.equal(readAccountData().transactions.length, 0)
  assert.doesNotMatch(container.querySelector('[aria-label="Debt row: The Home Depot"]').textContent, /installments/)
})

test('a Home Depot-style OCR scan shows every supported field in the rendered Add Debt form without saving', async () => {
  const container = await render(() => React.createElement(Debt, {
    statementExtractor: async () => parseDebtStatement(getReliableOcrLines(homeDepotOcrData))
  }))
  const before = ['money-honey-debts', 'money-honey-bills', 'money-honey-account-data'].map(key => browser.localStorage.getItem(key))
  await click(button(container, 'Add debt'))
  await click(button(container, 'Scan / Upload'))
  await chooseStatementFile(container, 'Statement image')
  const form = container.querySelector('form')
  const field = label => form.querySelector(`[aria-label="${label}"]`).value
  assert.equal(field('Debt name'), 'The Home Depot')
  assert.equal(field('Debt type'), 'Other')
  assert.equal(field('Starting balance · original amount borrowed or owed'), '1568')
  assert.equal(field('Current balance · amount still owed'), '296.74')
  assert.equal(field('Interest rate · annual percentage (optional)'), '24.99')
  assert.equal(field('Minimum payment · amount due each cycle (optional)'), '296.74')
  assert.equal(field('Next Payment Due'), '2026-11-16')
  assert.equal(field('Account Last 4 Digits'), '')
  assert.equal(field('Payment Schedule'), 'monthly')
  assert.equal(form.querySelector('[aria-label="Credit Limit"]'), null)
  assert.match(form.textContent, /Statement scanned\. Review your information before saving\./)
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'Home Depot plan')
  assert.equal(field('Current balance · amount still owed'), '296.74')
  assert.deepEqual(['money-honey-debts', 'money-honey-bills', 'money-honey-account-data'].map(key => browser.localStorage.getItem(key)), before)
})

test('compact Pay in 4 requires only balance and first due date and recalculates the four draft payments', async () => {
  const container = await render(Debt)
  await openManualDebt(container)
  const form = container.querySelector('form')
  assert.equal(form.querySelector('[aria-label="Statement autofill"]'), null)
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'Four payments')
  await changeValue(form.querySelector('[aria-label="Current balance · amount still owed"]'), '75.011')
  await submit(form)
  assert.match(form.querySelector('[role="alert"]').textContent, /two decimal/)
  await changeValue(form.querySelector('[aria-label="Current balance · amount still owed"]'), '100')
  assert.deepEqual([...form.querySelector('[aria-label="Payment Schedule"]').options].map(option => option.textContent), ['Monthly', 'Pay in 4'])
  await changeValue(form.querySelector('[aria-label="Payment Schedule"]'), 'pay-in-4')
  await submit(form)
  assert.match(form.querySelector('[role="alert"]').textContent, /date/)
  assert.equal(form.querySelector('[aria-label="First Payment Due Date"]').required, true)
  await changeValue(form.querySelector('[aria-label="First Payment Due Date"]'), '2026-11-16')
  assert.match(form.textContent, /Next scheduled payment: \$25\.00 · Nov 16, 2026/)
  await changeValue(form.querySelector('[aria-label="Current balance · amount still owed"]'), '75.01')
  await changeValue(form.querySelector('[aria-label="First Payment Due Date"]'), '2026-11-17')
  await changeValue(form.querySelector('[aria-label="Debt type"]'), 'Other')
  assert.match(form.textContent, /Next scheduled payment: \$18\.75 · Nov 17, 2026/)
  for (const label of ['Starting balance · original amount borrowed or owed', 'Completed Installments', 'Installment Amount', 'Usual Due Day', 'Total Installments']) {
    assert.equal(form.querySelector(`[aria-label="${label}"]`), null)
  }
  assert.doesNotMatch(form.textContent, /Review \/ adjust|Original plan|Frequency|Remaining Scheduled/)
  await submit(form)
  const debt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(debt.paymentSchedule.totalInstallments, 4)
  assert.equal(debt.startingBalance, 75.01)
  assert.equal(debt.currentBalance, 75.01)
  assert.equal(debt.paymentSchedule.completedInstallments, 0)
  assert.equal(debt.paymentHistory.length, 0)
  const bill = JSON.parse(browser.localStorage.getItem('money-honey-bills')).bills.find(item => item.debtId === debt.id)
  assert.deepEqual(bill.occurrenceOverrides.map(item => [item.dueDate, item.amount]), [
    ['2026-11-17', 18.75], ['2026-12-01', 18.75], ['2026-12-15', 18.75], ['2026-12-29', 18.76]
  ])
  assert.match(container.querySelector('[aria-label="Debt row: Four payments"]').textContent, /Next payment \$18\.75/)
  await click(container.querySelector('[aria-label="Debt row: Four payments"]'))
  await click(button(container, 'Edit Debt'))
  const editForm = container.querySelector('form')
  await changeValue(editForm.querySelector('[aria-label="Current balance · amount still owed"]'), '100.03')
  assert.match(editForm.textContent, /Next scheduled payment: \$25\.00 · Nov 17, 2026/)
  await submit(editForm)
  const editedBill = JSON.parse(browser.localStorage.getItem('money-honey-bills')).bills.find(item => item.debtId === debt.id)
  assert.deepEqual(editedBill.occurrenceOverrides.map(item => item.amount), [25, 25, 25, 25.03])
  assert.equal(loadDebts(browser.localStorage)[0].paymentHistory.length, 0)
})

test('editing a paid Pay in 4 plan keeps its original allocation, transactions and cleared status', async () => {
  saveDebts([{
    id: 8, name: 'Four payments', type: 'Other', startingBalance: 100.01, currentBalance: 100.01,
    minimumPayment: null, interestRate: 0, nextPaymentDue: '2026-11-16', paymentHistory: [],
    paymentSchedule: { kind: 'pay-in-4', frequency: 'biweekly', startDate: '2026-11-16', totalInstallments: 4, completedInstallments: 0, remainingTotal: 100.01 }
  }], browser.localStorage)
  synchronizeDebtBills(browser.localStorage)
  createDebtPayment(8, 'first-payment', { total: 25, principal: 25, date: '2026-11-16', accountId: 1 }, browser.localStorage)
  const accounts = readAccountData()
  accounts.transactions[0].cleared = true
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify(accounts))
  const container = await render(Debt)
  const before = loadDebts(browser.localStorage)[0]
  const transactionsBefore = readAccountData().transactions
  await click(container.querySelector('[aria-label="Debt row: Four payments"]'))
  await click(button(container, 'Edit Debt'))
  const form = container.querySelector('form')
  assert.match(form.textContent, /Next scheduled payment: \$25\.00 · Nov 30, 2026/)
  assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').value, '75.01')
  await changeValue(form.querySelector('[aria-label="Payment Schedule"]'), 'monthly')
  assert.equal(form.querySelector('[aria-label="Payment Schedule"]').value, 'pay-in-4')
  assert.match(form.querySelector('[role="alert"]').textContent, /kept to protect its links/)
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'Renamed plan')
  await submit(form)
  const after = loadDebts(browser.localStorage)[0]
  assert.equal(after.name, 'Renamed plan')
  assert.equal(after.currentBalance, before.currentBalance)
  assert.equal(after.startingBalance, before.startingBalance)
  assert.deepEqual(after.paymentSchedule, before.paymentSchedule)
  assert.deepEqual(after.paymentHistory, before.paymentHistory)
  assert.deepEqual(readAccountData().transactions, transactionsBefore)
  assert.equal(readAccountData().transactions[0].cleared, true)
})

test('legacy custom schedules and hidden statement values survive compact form edits without migration', async () => {
  const schedule = { kind: 'custom', frequency: 'days', intervalDays: 10, startDate: '2026-11-16',
    totalInstallments: 6, completedInstallments: 5, remainingTotal: 296.74,
    dateAdjustments: [{ scheduledDate: '2026-11-16', dueDate: '2026-11-17' }] }
  const statementDetails = { purchaseAmount: 1568, totalRepayment: 1780.64, totalInterest: 121.9, amountAlreadyPaid: 1483.9, nextPaymentAmount: 296.74 }
  saveDebts([{ id: 8, name: 'Saved custom plan', type: 'Other', startingBalance: 1780.64, currentBalance: 296.74,
    paymentHistory: [], paymentSchedule: schedule, statementDetails }], browser.localStorage)
  const container = await render(Debt)
  await click(container.querySelector('[aria-label="Debt row: Saved custom plan"]'))
  await click(button(container, 'Edit Debt'))
  const form = container.querySelector('form')
  assert.match(form.textContent, /existing schedule is kept/)
  assert.doesNotMatch(form.textContent, /Original Purchase Amount|Total Interest|Completed Before|Review \/ adjust/)
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'Renamed custom plan')
  await submit(form)
  const saved = loadDebts(browser.localStorage)[0]
  assert.deepEqual(saved.paymentSchedule, schedule)
  assert.deepEqual(saved.statementDetails, statementDetails)
  assert.equal(saved.currentBalance, 296.74)
  assert.equal(saved.startingBalance, 1780.64)
  assert.deepEqual(saved.paymentHistory, [])
  assert.equal(readAccountData().transactions.length, 0)
})

test('More opens Settings and Categories & Payees has a back path', async () => {
  const container = await render(App)
  const more = container.querySelector('nav')?.lastElementChild
  assert.ok(more)
  await click(more)
  assert.match(container.textContent, /More/)
  await click([...container.querySelectorAll('button')].find(item => item.textContent.includes('Settings')))
  assert.match(container.textContent, /Categories & Payees/)
  await click([...container.querySelectorAll('button')].find(item => item.textContent.includes('Categories & Payees')))
  await click([...container.querySelectorAll('button')].find(item => item.textContent.includes('Settings')))
  assert.equal(container.querySelector('h1')?.textContent, 'Settings')
})

function categoryNames(container, type) {
  const heading = [...container.querySelectorAll('h3')].find(item => item.textContent === `${type} categories`)
  return [...heading.parentElement.querySelectorAll('button')].map(item => item.textContent.trim())
}

test('preset and custom category deletion persists without reassigning or deleting any financial records', async () => {
  const data = readAccountData()
  data.transactions = [
    { id: 1, accountId: 1, name: 'Food', category: 'Groceries', amount: -50, date: localDate(), cleared: true },
    { id: 2, accountId: 1, name: 'Return', category: 'Groceries', amount: 10, date: localDate(), cleared: false },
    { id: 3, accountId: 1, name: 'Income', category: 'Groceries', categoryType: 'income', amount: 20, date: localDate(), cleared: true }
  ]
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify(data))
  browser.localStorage.setItem('money-honey-categories', JSON.stringify({
    version: 1, customCategories: [{ name: 'Coffee', type: 'expense' }, { name: 'Groceries', type: 'income' }]
  }))
  browser.localStorage.setItem('money-honey-manual-budgets', JSON.stringify({ budgets: { Groceries: 200, Coffee: 25 } }))
  const bills = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  bills.bills[0].category = 'Groceries'
  browser.localStorage.setItem('money-honey-bills', JSON.stringify(bills))
  const keys = ['money-honey-account-data', 'money-honey-bills', 'money-honey-manual-budgets', 'money-honey-debts']
  const before = keys.map(key => browser.localStorage.getItem(key))
  const Screen = () => React.createElement(Settings, {
    transactions: data.transactions,
    onTransactionsChange: () => assert.fail('Deletion must not rewrite transaction assignments')
  })
  let container = await render(Screen)
  await click(button(container, 'Groceries'))
  await click(button(container, 'Delete Category'))
  let dialog = [...container.querySelectorAll('[role="dialog"]')].at(-1)
  assert.match(dialog.textContent, /2 transactions currently use this category/)
  assert.match(dialog.textContent, /Nothing will be deleted or reassigned/)
  assert.equal(dialog.querySelector('select'), null)
  await click(button(dialog, 'Cancel'))
  assert.ok(categoryNames(container, 'Expense').includes('Groceries'))
  await click(button(container, 'Delete Category'))
  dialog = [...container.querySelectorAll('[role="dialog"]')].at(-1)
  await click(button(dialog, 'Delete'))
  assert.equal(categoryNames(container, 'Expense').includes('Groceries'), false)
  assert.ok(categoryNames(container, 'Income').includes('Groceries'))
  await click(button(container, 'Coffee'))
  await click(button(container, 'Delete Category'))
  await click(button([...container.querySelectorAll('[role="dialog"]')].at(-1), 'Delete'))
  assert.equal(categoryNames(container, 'Expense').includes('Coffee'), false)
  container = await reload(Screen, container)
  assert.equal(categoryNames(container, 'Expense').includes('Groceries'), false)
  assert.equal(categoryNames(container, 'Expense').includes('Coffee'), false)
  assert.deepEqual(keys.map(key => browser.localStorage.getItem(key)), before)
})

test('category and payee additions, duplicate errors and renames stay sorted and persist', async () => {
  const Screen = () => React.createElement(Settings, { transactions: [], onTransactionsChange: () => {} })
  let container = await render(Screen)
  const addCategory = async (name, type) => {
    await changeValue(container.querySelector('[aria-label="New category name"]'), name)
    await changeValue(container.querySelector('[aria-label="New category type"]'), type)
    await submit(container.querySelector('[aria-label="New category name"]').closest('form'))
  }
  await addCategory('zebra', 'expense')
  await addCategory('ALPHA', 'expense')
  await addCategory('zebra', 'income')
  await addCategory('Paycheck', 'expense')
  assert.equal(container.querySelector('[role="alert"]'), null)
  await addCategory(' ZEBRA ', 'expense')
  assert.match(container.querySelector('[role="alert"]').textContent, /already exists/)
  assert.equal(container.querySelector('[aria-label="New category name"]').value, ' ZEBRA ')
  await addCategory('', 'expense')
  assert.match(container.querySelector('[role="alert"]').textContent, /Enter a category name/)
  await click(button(container, 'zebra'))
  await changeValue(container.querySelector('[aria-label="Category name"]'), 'Groceries')
  await click(button(container, 'Save'))
  assert.match(container.querySelector('[role="alert"]').textContent, /already exists/)
  await changeValue(container.querySelector('[aria-label="Category name"]'), 'Aardvark')
  await click(button(container, 'Save'))
  assert.equal(categoryNames(container, 'Expense')[0], 'Aardvark')
  assert.ok(categoryNames(container, 'Income').includes('zebra'))
  for (const name of ['zulu', 'ALPHA', 'beta']) {
    await changeValue(container.querySelector('[aria-label="New payee name"]'), name)
    await submit(container.querySelector('[aria-label="New payee name"]').closest('form'))
  }
  await changeValue(container.querySelector('[aria-label="New payee name"]'), 'alpha')
  await submit(container.querySelector('[aria-label="New payee name"]').closest('form'))
  assert.match(container.querySelector('[role="alert"]').textContent, /already exists/)
  await click(button(container.querySelectorAll('main > section')[1], 'zulu'))
  await changeValue(container.querySelector('[aria-label="Payee name"]'), 'beta')
  await click(button(container, 'Save'))
  assert.match(container.querySelector('[role="alert"]').textContent, /already exists/)
  await changeValue(container.querySelector('[aria-label="Payee name"]'), 'Aardvark')
  await click(button(container, 'Save'))
  container = await reload(Screen, container)
  for (const type of ['Expense', 'Income']) {
    const names = categoryNames(container, type)
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })))
  }
  const payeeNames = [...container.querySelectorAll('main > section')[1].querySelectorAll('button')]
    .filter(item => item.type !== 'submit').map(item => item.textContent.trim())
  assert.deepEqual(payeeNames, ['Aardvark', 'ALPHA', 'beta'])
  assert.ok(categoryNames(container, 'Expense').includes('Paycheck'))
  assert.ok(categoryNames(container, 'Income').includes('Paycheck'))
})

test('catalog storage failures show helpful errors, preserve drafts and allow retry', async () => {
  const Screen = () => React.createElement(Settings, { transactions: [], onTransactionsChange: () => {} })
  const container = await render(Screen)
  const storage = browser.localStorage
  const original = storage.setItem
  Object.defineProperty(storage, 'setItem', {
    configurable: true,
    writable: true,
    value: (key, value) => {
      if (key === 'money-honey-categories' || key === 'money-honey-payees') throw new browser.DOMException('Full', 'QuotaExceededError')
      return original(key, value)
    }
  })
  try {
    await changeValue(container.querySelector('[aria-label="New category name"]'), 'Keep draft')
    await submit(container.querySelector('[aria-label="New category name"]').closest('form'))
    assert.match(container.querySelector('[role="alert"]').textContent, /storage may be full or unavailable/)
    assert.equal(container.querySelector('[aria-label="New category name"]').value, 'Keep draft')
    assert.equal(categoryNames(container, 'Expense').includes('Keep draft'), false)
    await changeValue(container.querySelector('[aria-label="New payee name"]'), 'Keep payee')
    await submit(container.querySelector('[aria-label="New payee name"]').closest('form'))
    assert.match(container.querySelector('[role="alert"]').textContent, /Could not save payees/)
    assert.equal(container.querySelector('[aria-label="New payee name"]').value, 'Keep payee')
    await click(button(container, 'Groceries'))
    await click(button(container, 'Delete Category'))
    const confirmation = [...container.querySelectorAll('[role="dialog"]')].at(-1)
    await click(button(confirmation, 'Delete'))
    assert.match(confirmation.querySelector('[role="alert"]').textContent, /not saved/)
    assert.ok(categoryNames(container, 'Expense').includes('Groceries'))
    Object.defineProperty(storage, 'setItem', { value: original })
    await click(button(confirmation, 'Delete'))
    assert.equal(categoryNames(container, 'Expense').includes('Groceries'), false)
    await submit(container.querySelector('[aria-label="New category name"]').closest('form'))
    assert.ok(categoryNames(container, 'Expense').includes('Keep draft'))
  } finally {
    Object.defineProperty(storage, 'setItem', { value: original })
  }
})

test('transaction selectors sort active catalogs, retain historical edits and distinguish same-named income and refunds', async () => {
  browser.localStorage.setItem('money-honey-categories', JSON.stringify({
    version: 1,
    customCategories: [{ name: 'Shared', type: 'income' }, { name: 'Shared', type: 'expense' }, { name: 'ALPHA', type: 'expense' }],
    disabledBuiltIns: ['expense:Groceries', 'expense:Other', 'income:Other Income']
  }))
  browser.localStorage.setItem('money-honey-payees', JSON.stringify({ version: 1, payees: ['zulu', 'ALPHA', 'beta'] }))
  const data = readAccountData()
  const historical = { id: 1, accountId: 1, name: 'Historical', category: 'Groceries', amount: -40, date: localDate(), cleared: true }
  data.transactions = [historical]
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify(data))
  let container = await render(Accounts)
  await click(buttonContaining(container, 'Checking'))
  await click(button(container, 'Add transaction'))
  let category = container.querySelector('[aria-label="Transaction category"]')
  assert.equal(category.value, '')
  assert.equal([...category.options].some(option => option.value === 'Groceries' || option.value === 'Other'), false)
  const names = [...category.options].slice(1).map(option => option.textContent)
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })))
  assert.deepEqual([...container.querySelectorAll('#saved-payees option')].map(option => option.value), ['ALPHA', 'beta', 'zulu'])
  for (const type of ['income', 'expense']) {
    if (type === 'expense') await click(button(container, 'Add transaction'))
    await changeValue(container.querySelector('[aria-label="Transaction type"]'), 'income')
    await changeValue(container.querySelector('[aria-label="Payee or description"]'), `Shared ${type}`)
    await changeValue(container.querySelector('[aria-label="Amount"]'), '10')
    category = container.querySelector('[aria-label="Transaction category"]')
    for (const group of category.querySelectorAll('optgroup')) {
      const options = [...group.querySelectorAll('option')].map(option => option.textContent)
      assert.deepEqual(options, [...options].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })))
    }
    await changeValue(category, JSON.stringify([type, 'Shared']))
    await submit(category.closest('form'))
    const saved = readAccountData().transactions.at(-1)
    assert.equal(saved.category, 'Shared')
    assert.equal(saved.categoryType, type)
    assert.equal(saved.amount, 10)
  }
  container = await reload(() => React.createElement(Accounts, { editRequest: { transactionId: 1, accountId: 1 } }), container)
  category = container.querySelector('[aria-label="Transaction category"]')
  assert.equal(category.value, 'Groceries')
  assert.match(category.selectedOptions[0].textContent, /not an active category/)
  await submit(category.closest('form'))
  const saved = readAccountData().transactions.find(item => item.id === 1)
  for (const [key, value] of Object.entries(historical)) assert.equal(saved[key], value)
})

test('bottom navigation opens Budgets and More shows Settings and Reports', async () => {
  const container = await render(App)
  const nav = container.querySelector('nav')
  assert.equal(nav.children[3].textContent.includes('Budgets'), true)
  await click(nav.children[3])
  assert.match(container.textContent, /Budgets/)
  assert.equal([...container.querySelectorAll('button')].some(item => item.classList.contains('page-back')), false)
  assert.equal(container.querySelector('.page-back-placeholder'), null)
  assert.equal(container.querySelector('h1')?.textContent, 'Budgets')
  assert.ok(button(container, 'Budget settings'))

  await click(nav.lastElementChild)
  assert.equal([...container.querySelectorAll('button')].some(item => item.textContent.includes('Ask Honey')), false)
  await click([...container.querySelectorAll('button')].find(item => item.textContent.includes('Reports')))
  assert.match(container.textContent, /Reports/)
})

test('selected preset theme persists when leaving Themes and across app reload', async () => {
  const container = await render(App)
  const nav = container.querySelector('nav')
  await click(nav.lastElementChild)
  await click(buttonContaining(container, 'Settings'))
  await click(buttonContaining(container, 'Themes & Fonts'))
  await click([...container.querySelectorAll('button')].find(item => item.textContent.includes('Moody Plum')))

  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-theme-settings')).themeId, 'moody-plum')
  await click(button(container, '‹ Settings'))
  assert.match(container.textContent, /Settings/)

  const reloaded = await reload(App, container)
  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-theme-settings')).themeId, 'moody-plum')
  await click(reloaded.querySelector('nav').lastElementChild)
  await click(buttonContaining(reloaded, 'Settings'))
  await click(buttonContaining(reloaded, 'Themes & Fonts'))
  assert.equal(
    [...reloaded.querySelectorAll('button[aria-pressed="true"]')].some(item => item.textContent.includes('Moody Plum')),
    true
  )
})

test('More disclaimer states bank verification accurately without changing its other paragraphs', async () => {
  const container = await render(App)
  await click(container.querySelector('nav').lastElementChild)
  const disclaimer = [...container.querySelectorAll('section')].find(section =>
    section.querySelector('h2')?.textContent.includes('Financial Disclaimer'))
  assert.ok(disclaimer)
  assert.deepEqual([...disclaimer.querySelectorAll('p')].map(paragraph => paragraph.textContent), [
    "Money Honey's financial forecasts, daily spending allowances, Smart Budgets, and automated suggestions are estimates based on the information you enter.",
    'Actual balances, payments, and expenses may differ. Predictions may improve as you use the app and build a more complete financial history, but accuracy is never guaranteed.',
    'Always verify important financial decisions against your bank accounts and actual bills.',
    'Money Honey does not verify your balances or transactions with your bank.'
  ])
})

beforeEach(() => {
  seedData()
  browser.confirm = () => true
  browser.alert = message => {
    throw new Error(message)
  }
})

afterEach(async () => {
  for (const root of roots) {
    await act(async () => root.unmount())
  }
  roots.clear()
  rootContainers.clear()
  browser.document.body.replaceChildren()
})

after(async () => {
  await vite.close()
  browser.happyDOM.abort()
})

test('bill row opens editing directly; Pay records once and Paid requires confirmation to undo', async () => {
  let container = await render(Bills)
  await click(container.querySelector('[aria-label="Bill row: Electric"]'))
  const editDialog = container.querySelector('[role="dialog"]')
  assert.match(editDialog.querySelector('h2').textContent, /Edit bill occurrence/)
  assert.equal([...editDialog.querySelectorAll('button')].some(item =>
    item.textContent.trim() === 'Skip This Payment' || item.textContent.trim() === 'Undo Skip'
  ), false)
  await click(button(editDialog, 'Cancel'))

  await click(button(container, 'Pay Electric'))
  assert.ok(container.querySelector('[role="dialog"] input[aria-label="Actual payment date"]'))
  await click(button(container.querySelector('[role="dialog"]'), 'Confirm'))

  let data = readAccountData()
  assert.equal(data.transactions.length, 1)
  assert.deepEqual({
    amount: data.transactions[0].amount,
    cleared: data.transactions[0].cleared,
    linkedOccurrenceId: data.transactions[0].linkedOccurrenceId
  }, {
    amount: -80,
    cleared: false,
    linkedOccurrenceId: `bill:1:${localDate()}`
  })

  assert.equal(container.querySelector('[aria-label="Bill row: Electric"]'), null)
  assert.equal(readAccountData().transactions.length, 1)
  const reloadedContainer = await reload(Bills, container)
  assert.equal(reloadedContainer.querySelector('[aria-label="Show Completed"]').checked, false)
  assert.equal(reloadedContainer.querySelector('[aria-label="Bill row: Electric"]'), null)
  assert.equal(readAccountData().transactions.length, 1)
  container = reloadedContainer
  await click(container.querySelector('[aria-label="Show Completed"]'))
  assert.ok(button(container, 'Paid Electric'))
  browser.confirm = () => false
  await click(button(container, 'Paid Electric'))
  assert.ok(button(container, 'Paid Electric'))
  assert.equal(readAccountData().transactions.length, 1)

  browser.confirm = () => true
  await click(button(container, 'Paid Electric'))
  assert.ok(button(container, 'Pay Electric'))
  data = readAccountData()
  assert.equal(data.transactions.length, 0)
  assert.equal(data.accounts[0].openingBalance, 1000)
  await click(container.querySelector('[aria-label="Show Completed"]'))
  assert.ok(button(container, 'Pay Electric'))
})

test('income row opens editing directly; Receive records once and Received confirms undo', async () => {
  const container = await render(Bills)
  await click(button(container, 'Money In'))
  await click(container.querySelector('[aria-label="Income row: Paycheck"]'))
  const editDialog = container.querySelector('[role="dialog"]')
  assert.match(editDialog.querySelector('h2').textContent, /Edit income occurrence/)
  assert.equal([...editDialog.querySelectorAll('button')].some(item =>
    item.textContent.trim() === 'Skip This Payment' || item.textContent.trim() === 'Undo Skip'
  ), false)
  await click(button(editDialog, 'Cancel'))

  await click(button(container, 'Receive Paycheck'))
  assert.ok(container.querySelector('[role="dialog"] input[aria-label="Actual received date"]'))
  await click(button(container.querySelector('[role="dialog"]'), 'Confirm'))

  let data = readAccountData()
  assert.equal(data.transactions.length, 1)
  assert.deepEqual({
    amount: data.transactions[0].amount,
    cleared: data.transactions[0].cleared,
    linkedOccurrenceId: data.transactions[0].linkedOccurrenceId
  }, {
    amount: 1200,
    cleared: false,
    linkedOccurrenceId: `income:2:${localDate()}`
  })

  assert.equal(container.querySelector('[aria-label="Income row: Paycheck"]'), null)
  await click(container.querySelector('[aria-label="Show Completed"]'))
  assert.ok(button(container, 'Received Paycheck'))
  browser.confirm = () => false
  await click(button(container, 'Received Paycheck'))
  assert.ok(button(container, 'Received Paycheck'))
  assert.equal(readAccountData().transactions.length, 1)

  browser.confirm = () => true
  await click(button(container, 'Received Paycheck'))
  assert.ok(button(container, 'Receive Paycheck'))
  data = readAccountData()
  assert.equal(data.transactions.length, 0)
  assert.equal(data.accounts[0].openingBalance, 1000)
  await click(container.querySelector('[aria-label="Show Completed"]'))
  assert.ok(button(container, 'Receive Paycheck'))
})

test('editing a paid occurrence confirms linked changes and preserves its actual payment date', async () => {
  const container = await render(Bills)
  await click(button(container, 'Pay Electric'))
  const actualDate = localDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
  await changeValue(
    container.querySelector('[role="dialog"] input[aria-label="Actual payment date"]'),
    actualDate
  )
  await click(button(container.querySelector('[role="dialog"]'), 'Confirm'))

  await click(container.querySelector('[aria-label="Show Completed"]'))
  await click(container.querySelector('[aria-label="Bill row: Electric"]'))
  const dialog = container.querySelector('[role="dialog"]')
  await changeValue(dialog.querySelector('[aria-label="Bill name"]'), 'Updated Electric')
  browser.confirm = () => false
  await submit(dialog.querySelector('form'))
  assert.equal(readAccountData().transactions[0].name, 'Electric')

  browser.confirm = () => true
  await submit(dialog.querySelector('form'))
  const data = readAccountData()
  assert.equal(data.transactions.length, 1)
  assert.equal(data.transactions[0].name, 'Updated Electric')
  assert.equal(data.transactions[0].date, actualDate)
  assert.equal(data.transactions[0].amount, -80)
})

test('recurring row offers occurrence or schedule scope and only changes the selected occurrence', async () => {
  seedData({ recurring: true })
  const container = await render(Bills)
  await click(button(container, 'Calendar'))
  await click(button(container, 'Pay Repeating'))
  assert.ok(container.querySelector('[role="dialog"] input[aria-label="Actual payment date"]'))
  await click(button(container.querySelector('[role="dialog"]'), 'Cancel'))
  await click(container.querySelector('[aria-label="Bill row: Repeating"]'))
  const dialog = container.querySelector('[role="dialog"]')
  const scope = value => dialog.querySelector(`input[name="edit-scope"][value="${value}"]`)
  assert.equal(scope('occurrence').checked, true)
  await click(scope('schedule'))
  assert.ok(dialog.querySelector('select[aria-label="Frequency"]'))
  await click(scope('occurrence'))
  assert.equal(dialog.querySelector('select[aria-label="Frequency"]'), null)

  await changeValue(dialog.querySelector('input[aria-label="Bill name"]'), 'One-time change')
  await submit(dialog.querySelector('form'))
  const saved = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  assert.equal(saved.bills[0].name, 'Repeating')
  assert.equal(saved.bills[0].occurrenceOverrides.length, 1)
  assert.equal(saved.bills[0].occurrenceOverrides[0].name, 'One-time change')
})

test('Bills List keeps urgency and income month headings inset without negative margins', async () => {
  seedData({ recurring: true, recurringIncome: true })
  const container = await render(Bills)
  const before = [
    browser.localStorage.getItem('money-honey-bills'),
    browser.localStorage.getItem('money-honey-account-data')
  ]

  for (const flow of ['out', 'in']) {
    if (flow === 'in') await click(button(container, 'Money In'))
    const list = container.querySelector('.bills-list')
    assert.ok(list)
    const months = [...list.querySelectorAll('.bill-list-month')]
    assert.equal(months.length, flow === 'out' ? 3 : 12)
    for (const month of months) {
      const monthStyle = browser.getComputedStyle(month)
      assert.ok(parseFloat(monthStyle.paddingLeft) >= 8)
      assert.equal(monthStyle.paddingLeft, monthStyle.paddingRight)
      assert.equal(monthStyle.boxSizing, 'border-box')
      const heading = month.firstElementChild
      const row = month.querySelector('[role="group"]')
      const headingStyle = browser.getComputedStyle(heading)
      assert.ok(parseFloat(headingStyle.marginLeft) >= 0)
      assert.ok(parseFloat(headingStyle.marginRight) >= 0)
      if (!row) continue
      const rowStyle = browser.getComputedStyle(row)
      assert.equal(headingStyle.paddingLeft, rowStyle.paddingLeft)
      assert.equal(headingStyle.paddingRight, rowStyle.paddingRight)
      assert.equal(rowStyle.boxSizing, 'border-box')
      assert.ok(row.querySelector('button'))
    }
  }
  assert.ok(container.querySelector('[aria-label="Show Completed"]'))
  assert.ok(container.querySelector('[aria-label="Add income"]'))
  await click(button(container, 'Calendar'))
  assert.equal(container.querySelector('.bills-list'), null)
  assert.equal(container.querySelector('.bill-list-month'), null)
  assert.deepEqual([
    browser.localStorage.getItem('money-honey-bills'),
    browser.localStorage.getItem('money-honey-account-data')
  ], before)
})

test('List groups a bounded year of recurring bills by urgency, and retains income months and Calendar controls', async () => {
  seedData({ recurring: true, recurringIncome: true })
  const container = await render(Bills)
  const billRows = container.querySelectorAll('[aria-label="Bill row: Repeating"]')
  const billMonthGroups = [...container.querySelectorAll('section[aria-label$="bills"]')]
  assert.equal(billRows.length, 12)
  assert.deepEqual(billMonthGroups.map(group => group.querySelector('h2').textContent), [
    'Past Due', 'Due Within 30 Days', 'Due Beyond 30 Days'
  ])
  assert.equal(container.querySelector('[aria-label="Previous month"]'), null)
  assert.equal(container.querySelector('[aria-label="Next month"]'), null)
  assert.equal(container.querySelector('[aria-label="Monthly total due"]'), null)
  assert.match(billMonthGroups[0].textContent, /\$0\.00/)
  assert.equal(billMonthGroups.slice(1).reduce((sum, group) =>
    sum + group.querySelectorAll('[aria-label="Bill row: Repeating"]').length, 0), 12)

  await click(button(container, 'Money In'))
  const incomeRows = container.querySelectorAll('[aria-label="Income row: Paycheck"]')
  const incomeMonthGroups = [...container.querySelectorAll('section[aria-label$="income"]')]
  assert.equal(incomeRows.length, 12)
  assert.equal(incomeMonthGroups.length, 12)
  assert.equal(container.querySelector('[aria-label="Monthly total incoming"]'), null)
  assert.match(incomeMonthGroups[0].textContent, /\$1,200\.00/)
  assert.match(incomeMonthGroups.at(-1).textContent, /\$1,200\.00/)
  assert.match(incomeMonthGroups[0].textContent, /Total scheduled/)
  const savedBills = browser.localStorage.getItem('money-honey-bills')
  const savedAccounts = browser.localStorage.getItem('money-honey-account-data')

  await click(button(container, 'Calendar'))
  assert.ok(container.querySelector('[aria-label="Previous month"]'))
  assert.ok(container.querySelector('[aria-label="Next month"]'))
  assert.ok(container.querySelector('[aria-label="Monthly total incoming"]'))
  assert.ok(container.querySelector('[aria-label="Income row: Paycheck"]'))
  assert.equal(container.querySelector('[role="dialog"]'), null)

  const currentDay = container.querySelector(`[aria-label^="${localDate()}"]`)
  assert.ok(currentDay)
  await click(currentDay)
  assert.ok(container.querySelector('[aria-live="polite"] [aria-label="Income row: Paycheck"]'))

  await click(button(container, 'List'))
  assert.equal(container.querySelector('[aria-label="Previous month"]'), null)
  assert.equal(container.querySelector('[aria-label="Next month"]'), null)
  assert.equal(browser.localStorage.getItem('money-honey-bills'), savedBills)
  assert.equal(browser.localStorage.getItem('money-honey-account-data'), savedAccounts)

  await click(button(container, 'Calendar'))
  await click(button(container, 'Previous month'))
  assert.match(container.querySelector('[aria-label="Monthly total incoming"]').textContent, /\$0\.00/)
  assert.equal(container.querySelectorAll('[aria-label="Income row: Paycheck"]').length, 0)
  await click(button(container, 'Next month'))
  assert.match(container.querySelector('[aria-label="Monthly total incoming"]').textContent, /\$1,200\.00/)
})

test('bill urgency refreshes with the local date on resume and includes both 30-day endpoints', async t => {
  const now = new Date(2026, 2, 8, 23, 59)
  t.mock.timers.enable({ apis: ['Date'], now: now.getTime() })
  const today = localDate()
  const items = [
    { name: 'Yesterday', dueDate: shiftDate(today, -1), amount: 10.11 },
    { name: 'Today', dueDate: today, amount: 20.22 },
    { name: 'Day 30', dueDate: shiftDate(today, 30), amount: 30.33 },
    { name: 'Day 31', dueDate: shiftDate(today, 31), amount: 40.44 }
  ]
  browser.localStorage.setItem('money-honey-bills', JSON.stringify({
    version: 1,
    bills: items.map((item, index) => ({ ...item, id: index + 1, frequency: 'one-time', paymentHistory: [] })),
    incomes: []
  }))
  const before = browser.localStorage.getItem('money-honey-bills')
  const container = await render(Bills)
  const group = label => container.querySelector(`[aria-label="${label} bills"]`)
  assert.match(group('Past Due').querySelector('strong').textContent, /\$10\.11/)
  assert.match(group('Due Within 30 Days').querySelector('strong').textContent, /\$50\.55/)
  assert.ok(group('Due Within 30 Days').querySelector('[aria-label="Bill row: Today"]'))
  assert.ok(group('Due Within 30 Days').querySelector('[aria-label="Bill row: Day 30"]'))
  assert.ok(group('Due Beyond 30 Days').querySelector('[aria-label="Bill row: Day 31"]'))
  t.mock.timers.setTime(new Date(2026, 2, 9, 0, 1).getTime())
  await act(async () => browser.dispatchEvent(new browser.Event('focus')))
  assert.ok(group('Past Due').querySelector('[aria-label="Bill row: Today"]'))
  assert.match(group('Past Due').querySelector('strong').textContent, /\$30\.33/)
  assert.ok(group('Due Within 30 Days').querySelector('[aria-label="Bill row: Day 31"]'))
  assert.match(group('Due Beyond 30 Days').querySelector('strong').textContent, /\$0\.00/)
  assert.equal(browser.localStorage.getItem('money-honey-bills'), before)
})

test('List includes historical bill and income occurrences before the current month', async () => {
  seedData()
  browser.localStorage.setItem('money-honey-bills', JSON.stringify({
    version: 1,
    bills: [{
      id: 10,
      name: 'Historical Electric',
      amount: 72,
      dueDate: '2026-10-20',
      frequency: 'one-time',
      accountId: 1,
      paymentHistory: []
    }],
    incomes: [{
      id: 20,
      name: 'Historical Paycheck',
      amount: 900,
      dueDate: '2026-10-20',
      frequency: 'one-time',
      accountId: 1,
      paymentHistory: []
    }]
  }))

  const container = await render(Bills)
  assert.ok(container.querySelector('[aria-label="Past Due bills"]'))
  assert.ok(container.querySelector('[aria-label="Bill row: Historical Electric"]'))
  assert.match(container.querySelector('[aria-label="Bill row: Historical Electric"]').textContent, /Oct 20, 2026/)
  assert.match(container.querySelector('[aria-label="Past Due bills"]').textContent, /\$72\.00/)

  await click(button(container, 'Money In'))
  assert.ok(container.querySelector('[aria-label="October 2026 income"]'))
  assert.ok(container.querySelector('[aria-label="Income row: Historical Paycheck"]'))
  assert.match(container.querySelector('[aria-label="October 2026 income"]').textContent, /\$900\.00/)
})

test('List hides completed bills and totals, retains unpaid history, and preserves income month behavior', async () => {
  const monthDate = (offset, day = 10) => {
    const now = new Date()
    return new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, day))
      .toISOString()
      .slice(0, 10)
  }
  const olderPaid = monthDate(-2)
  const partialPaid = monthDate(-1, 5)
  const partialUnpaid = monthDate(-1, 20)
  const currentPaid = monthDate(0)
  const futureDue = monthDate(1)

  browser.localStorage.setItem('money-honey-bills', JSON.stringify({
    version: 1,
    bills: [
      { id: 1, name: 'Old paid bill', amount: 10, dueDate: olderPaid, frequency: 'one-time', paymentHistory: [{ dueDate: olderPaid, paid: true }] },
      { id: 2, name: 'Partial paid bill', amount: 20, dueDate: partialPaid, frequency: 'one-time', paymentHistory: [{ dueDate: partialPaid, paid: true }] },
      { id: 3, name: 'Partial unpaid bill', amount: 30, dueDate: partialUnpaid, frequency: 'one-time', paymentHistory: [] },
      { id: 4, name: 'Current paid bill', amount: 40, dueDate: currentPaid, frequency: 'one-time', paymentHistory: [{ dueDate: currentPaid, paid: true }] },
      { id: 5, name: 'Future bill', amount: 50, dueDate: futureDue, frequency: 'one-time', paymentHistory: [] }
    ],
    incomes: [
      { id: 6, name: 'Old received income', amount: 100, dueDate: olderPaid, frequency: 'one-time', paymentHistory: [{ dueDate: olderPaid, status: 'received' }] },
      { id: 7, name: 'Partial received income', amount: 200, dueDate: partialPaid, frequency: 'one-time', paymentHistory: [{ dueDate: partialPaid, status: 'received' }] },
      { id: 8, name: 'Partial expected income', amount: 300, dueDate: partialUnpaid, frequency: 'one-time', paymentHistory: [] },
      { id: 9, name: 'Current received income', amount: 400, dueDate: currentPaid, frequency: 'one-time', paymentHistory: [{ dueDate: currentPaid, status: 'received' }] },
      { id: 10, name: 'Future income', amount: 500, dueDate: futureDue, frequency: 'one-time', paymentHistory: [] }
    ]
  }))

  const container = await render(Bills)
  const oldBillMonth = new Date(`${olderPaid}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC'
  })
  const partialBillMonth = new Date(`${partialPaid}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC'
  })
  const currentBillMonth = new Date(`${currentPaid}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC'
  })

  assert.equal(container.querySelector('[aria-label="Bill row: Old paid bill"]'), null)
  const pastDue = container.querySelector('[aria-label="Past Due bills"]')
  assert.ok(pastDue.querySelector('[aria-label="Bill row: Partial unpaid bill"]'))
  assert.equal(container.querySelector('[aria-label="Bill row: Partial paid bill"]'), null)
  assert.equal(container.querySelector('[aria-label="Bill row: Current paid bill"]'), null)
  assert.match(pastDue.querySelector('strong').textContent, /\$30\.00/)
  assert.ok(container.querySelector('[aria-label$="bills"] [aria-label="Bill row: Future bill"]'))

  await click(container.querySelector('[aria-label="Show Completed"]'))
  assert.ok(container.querySelector('[aria-label="Bill row: Old paid bill"]'))
  assert.ok(container.querySelector('[aria-label="Bill row: Partial paid bill"]'))
  assert.ok(container.querySelector('[aria-label="Bill row: Current paid bill"]'))
  await click(container.querySelector('[aria-label="Show Completed"]'))

  await click(button(container, 'Money In'))
  assert.equal(container.querySelector(`[aria-label="${oldBillMonth} income"]`), null)
  assert.ok(container.querySelector(`[aria-label="${partialBillMonth} income"] [aria-label="Income row: Partial expected income"]`))
  assert.equal(container.querySelector(`[aria-label="${partialBillMonth} income"] [aria-label="Income row: Partial received income"]`), null)
  assert.ok(container.querySelector(`[aria-label="${currentBillMonth} income"]`))
  assert.equal(container.querySelector(`[aria-label="${currentBillMonth} income"] [aria-label="Income row: Current received income"]`), null)

  await click(container.querySelector('[aria-label="Show Completed"]'))
  assert.ok(container.querySelector(`[aria-label="${oldBillMonth} income"] [aria-label="Income row: Old received income"]`))
  assert.ok(container.querySelector(`[aria-label="${partialBillMonth} income"] [aria-label="Income row: Partial received income"]`))
})

test('adding or moving an occurrence into a past month updates List without a reload', async () => {
  const container = await render(Bills)
  await click(button(container, 'Add bill'))
  const form = container.querySelector('[role="dialog"] form')
  await changeValue(form.querySelector('[aria-label="Bill name"]'), 'Past-dated bill')
  await changeValue(form.querySelector('[aria-label="Amount"]'), '45')
  await changeValue(form.querySelector('[aria-label="Due date"]'), '2026-10-20')
  await submit(form)

  assert.ok(container.querySelector('[aria-label="Past Due bills"] [aria-label="Bill row: Past-dated bill"]'))

  await click(container.querySelector('[aria-label="Bill row: Past-dated bill"]'))
  const editForm = container.querySelector('[role="dialog"] form')
  await changeValue(editForm.querySelector('[aria-label="Due date"]'), '2026-09-20')
  await submit(editForm)
  assert.ok(container.querySelector('[aria-label="Past Due bills"] [aria-label="Bill row: Past-dated bill"]'))
})

test('paying one recurring bill hides only that occurrence; completed bills remain visible in Calendar', async () => {
  seedData({ recurring: true })
  const container = await render(Bills)
  assert.equal(container.querySelectorAll('[aria-label="Bill row: Repeating"]').length, 12)
  await click(button(container, 'Pay Repeating'))
  await click(button(container.querySelector('[role="dialog"]'), 'Confirm'))

  assert.equal(container.querySelectorAll('[aria-label="Bill row: Repeating"]').length, 11)
  assert.ok(container.querySelector('[aria-label="Due Beyond 30 Days bills"] [aria-label="Bill row: Repeating"]'))
  await click(container.querySelector('[aria-label="Show Completed"]'))
  assert.equal(container.querySelectorAll('[aria-label="Bill row: Repeating"]').length, 12)
  assert.ok(button(container, 'Paid Repeating'))

  await click(button(container, 'Calendar'))
  assert.ok(button(container, 'Paid Repeating'))
  assert.equal(readAccountData().transactions.length, 1)
  assert.equal(readAccountData().transactions[0].cleared, false)
})

test('compact overview pairs account identity with unchanged balances and opens each account without changing saved data', async () => {
  const accounts = [
    { name: 'Checking', type: 'Checking', openingBalance: 1000 },
    { name: 'Credit card', type: 'Credit Card', openingBalance: -999.99 },
    { name: 'A very long savings account name that should remain accessible on narrow screens', type: 'Savings', openingBalance: 500 },
    { name: 'Cash', type: 'Cash', openingBalance: 0 },
    { name: 'Investments', type: 'Investment', openingBalance: 1234567.89 },
    { name: 'Archived account', type: 'Other', openingBalance: 100 }
  ].map((account, index) => ({
    ...account, id: index + 1, color: '#123456', openingDate: '2026-11-01',
    defaultCleared: false, archived: index === 5
  }))
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    version: 1,
    accounts,
    transactions: [
      { id: 1, sequence: 1, accountId: 1, name: 'Cleared expense', amount: -50, date: '2026-11-02', cleared: true },
      { id: 2, sequence: 2, accountId: 1, name: 'Pending expense', amount: -25, date: '2026-11-03', cleared: false }
    ]
  }))
  const container = await render(Accounts)
  const before = browser.localStorage.getItem('money-honey-account-data')
  assert.ok(container.querySelector('.accounts-overview'))
  const cards = [...container.querySelectorAll('.account-overview-card')]
  assert.equal(cards.length, 5)
  assert.doesNotMatch(container.textContent, /Archived account/)

  for (const [index, card] of cards.entries()) {
    assert.equal(card.children.length, 2)
    const identity = card.querySelector('.account-overview-identity')
    const totals = card.querySelector('.account-overview-totals')
    assert.equal(identity.children.length, 2)
    assert.equal(identity.querySelector('strong').textContent, accounts[index].name)
    assert.equal(identity.lastElementChild.textContent, accounts[index].type)
    assert.equal(identity.querySelector('strong').title, accounts[index].name)
    assert.equal(totals.children.length, 2)
    const format = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    assert.equal(totals.querySelector('strong').textContent, format(index === 0 ? 950 : accounts[index].openingBalance))
    assert.equal(totals.lastElementChild.textContent, `Available ${format(index === 0 ? 925 : accounts[index].openingBalance)}`)
    assert.ok(card.getAttribute('aria-label').includes(accounts[index].name))
    assert.equal(card.style.borderLeft, '5px solid #123456')
  }

  for (const account of accounts.filter(item => !item.archived)) {
    await click(container.querySelector(`[data-account-id="${account.id}"]`))
    assert.equal(container.querySelector('h1').textContent, account.name)
    assert.ok(container.querySelector('[aria-label="Add transaction"]'))
    assert.equal(container.querySelector('.accounts-overview'), null)
    assert.equal(container.querySelector('.account-overview-card'), null)
    assert.equal(browser.localStorage.getItem('money-honey-account-data'), before)
    await click(buttonContaining(container, 'Accounts'))
  }
})

test('account detail summary preserves all three large balances and the full account title', async () => {
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    version: 1,
    accounts: [{
      id: 1, name: 'Investments', type: 'Investment', openingBalance: 123456.78,
      openingDate: '2026-11-01', color: '#B87522', defaultCleared: false, archived: false
    }],
    transactions: [
      { id: 1, sequence: 1, accountId: 1, name: 'Deposit', amount: 1000000, date: '2026-11-02', cleared: true },
      { id: 2, sequence: 2, accountId: 1, name: 'Pending expense', amount: -123456.78, date: '2026-11-03', cleared: false }
    ]
  }))
  const container = await render(Accounts)
  const before = browser.localStorage.getItem('money-honey-account-data')
  await click(container.querySelector('[data-account-id="1"]'))
  assert.equal(container.querySelector('.page-header h1').textContent, 'Investments')
  const summary = container.querySelector('[aria-label="Account balances"]')
  assert.deepEqual([...summary.querySelectorAll('p')].map(element => element.textContent), ['BALANCE', 'AVAILABLE', 'UNCLEARED'])
  assert.deepEqual([...summary.querySelectorAll('.account-summary-value')].map(element => element.textContent), [
    '$1,123,456.78', '$1,000,000.00', '$123,456.78'
  ])
  assert.equal(summary.querySelectorAll('.account-summary-item').length, 3)
  assert.match(summary.textContent, /Going out/)
  assert.equal(browser.localStorage.getItem('money-honey-account-data'), before)
})

test('transaction row edits directly; clearing and inline date changes do not open the editor', async () => {
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    version: 1,
    accounts: [{
      id: 1,
      name: 'Checking',
      type: 'Checking',
      openingBalance: 1500,
      openingDate: '2026-11-06',
      defaultCleared: false,
      archived: false
    }],
    transactions: [
      { id: 1, sequence: 1, accountId: 1, name: 'Paycheck', amount: 1500, date: '2026-11-06', cleared: true },
      { id: 2, sequence: 2, accountId: 1, name: 'Groceries', amount: -125, date: '2026-11-06', cleared: true },
      { id: 3, sequence: 3, accountId: 1, name: 'Electric', amount: -128, date: '2026-11-07', cleared: false }
    ]
  }))
  const container = await render(Accounts)
  await click(container.querySelector('[data-account-id="1"]'))
  const row = container.querySelector('[data-transaction-id="1"]')
  await click(row)
  assert.equal(container.querySelector('[role="dialog"] h2').textContent, 'Edit Transaction')

  const dialog = container.querySelector('[role="dialog"]')
  await changeValue(dialog.querySelector('[aria-label="Payee or description"]'), 'Updated Paycheck')
  await changeValue(dialog.querySelector('[aria-label="Amount"]'), '1600')
  await submit(dialog.querySelector('form'))
  let data = readAccountData()
  assert.equal(data.transactions[0].name, 'Updated Paycheck')
  assert.equal(data.transactions[0].amount, 1600)
  assert.equal(data.transactions[0].cleared, true)
  assert.match(container.textContent, /\$2,975\.00/)
  assert.match(container.textContent, /\$2,847\.00/)

  const editedRow = container.querySelector('[data-transaction-id="1"]')
  await click(button(editedRow, 'Mark pending'))
  assert.equal(container.querySelector('[role="dialog"]'), null)
  await click(button(editedRow, 'Mark cleared'))
  const date = editedRow.querySelector('input[type="date"]')
  await click(date)
  assert.equal(container.querySelector('[role="dialog"]'), null)
  await changeValue(date, '2026-11-08')
  data = readAccountData()
  assert.equal(data.transactions.find(item => item.id === 1).date, '2026-11-08')
  assert.equal(editedRow.querySelector('time').textContent, '11/8/2026')
  assert.equal(editedRow.querySelector('time').dateTime, '2026-11-08')
  assert.equal(container.querySelector('[role="dialog"]'), null)
})

test('ordinary transaction deletion requires confirmation, persists, and recalculates account balances', async () => {
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    version: 1,
    accounts: [
      { id: 1, name: 'Checking', type: 'Checking', openingBalance: 500, openingDate: '2026-11-06', defaultCleared: false, archived: false },
      { id: 2, name: 'Savings', type: 'Savings', openingBalance: 200, openingDate: '2026-11-06', defaultCleared: false, archived: false }
    ],
    transactions: [
      { id: 1, sequence: 1, accountId: 1, name: 'Deposit', amount: 200, date: '2026-11-06', cleared: true },
      { id: 2, sequence: 2, accountId: 1, name: 'Coffee', amount: -50, date: '2026-11-07', cleared: false },
      { id: 3, sequence: 3, accountId: 1, name: 'Groceries', amount: -25, date: '2026-11-08', cleared: true },
      { id: 4, sequence: 4, accountId: 2, name: 'Savings deposit', amount: 40, date: '2026-11-08', cleared: true }
    ]
  }))
  const container = await render(Accounts)
  await click(container.querySelector('[data-account-id="1"]'))
  await click(button(container, 'Add transaction'))
  const addDialog = container.querySelector('[role="dialog"]')
  assert.equal(addDialog.querySelector('[aria-label="Delete Transaction"]'), null)
  await click(button(addDialog, 'Cancel'))
  await click(container.querySelector('[data-transaction-id="2"]'))
  let editDialog = container.querySelector('[role="dialog"]')
  assert.ok(button(editDialog, 'Delete Transaction'))
  await click(button(editDialog, 'Delete Transaction'))
  let confirmation = container.querySelector('[aria-labelledby="delete-transaction-title"]')
  assert.match(confirmation.textContent, /Coffee/)
  assert.match(confirmation.textContent, /-\$50\.00/)
  assert.doesNotMatch(confirmation.textContent, /linked|reverse/i)
  await click(button(confirmation, 'Cancel'))
  assert.equal(readAccountData().transactions.length, 4)
  assert.ok(container.querySelector('[role="dialog"]'))

  await click(button(editDialog, 'Delete Transaction'))
  confirmation = container.querySelector('[aria-labelledby="delete-transaction-title"]')
  await click(button(confirmation, 'Delete'))
  const data = readAccountData()
  assert.deepEqual(data.transactions.map(item => item.id), [1, 3, 4])
  assert.equal(data.transactions.find(item => item.id === 4).accountId, 2)
  assert.equal(container.querySelector('[data-transaction-id="2"]'), null)
  assert.match(container.textContent, /\$675\.00/)
  assert.match(container.textContent, /No net amount/)
  const billData = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  assert.equal(billData.bills[0].name, 'Electric')
  assert.equal(billData.incomes[0].name, 'Paycheck')
})

test('deleting a linked recurring debt transaction reverses only its bill occurrence and debt payment', async () => {
  seedData({ recurring: true })
  const date = localDate()
  const occurrenceId = `bill:1:${date}`
  const savedBills = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  savedBills.bills[0] = {
    ...savedBills.bills[0],
    name: 'Auto loan',
    amount: 24,
    debtId: 8,
    paymentHistory: [
      { dueDate: date, actualDate: shiftDate(date, -1), transactionId: 1, paid: true },
      { dueDate: nextMonthlyDate(date), transactionId: 2, paid: true }
    ]
  }
  browser.localStorage.setItem('money-honey-bills', JSON.stringify(savedBills))
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({
    version: 1,
    debts: [{
      id: 8,
      name: 'Auto loan',
      type: 'Auto Loan',
      startingBalance: 200,
      currentBalance: 176,
      interestRate: 35,
      minimumPayment: 24,
      nextPaymentDue: date,
      paymentCalculationMethod: 'principal-only',
      billId: 1,
      paymentHistory: [{
        id: '8:1',
        sequence: 1,
        transactionId: 1,
        date: shiftDate(date, -1),
        total: 24,
        principal: 24,
        interest: 0,
        fees: 0,
        automaticPrincipal: true,
        calculationMethod: 'principal-only',
        scheduledDueDate: date,
        billOccurrenceId: occurrenceId
      }]
    }]
  }))
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    ...readAccountData(),
    transactions: [
      {
        id: 1,
        sequence: 1,
        accountId: 1,
        name: 'Auto loan',
        amount: -24,
        date: shiftDate(date, -1),
        cleared: true,
        linkedOccurrenceType: 'bill',
        linkedOccurrenceId: occurrenceId,
        linkedBillOccurrenceId: occurrenceId,
        linkedDebtId: 8,
        linkedDebtPaymentId: '8:1',
        transactionType: 'debt-payment'
      },
      {
        id: 2,
        sequence: 2,
        accountId: 1,
        name: 'Auto loan',
        amount: -24,
        date: nextMonthlyDate(date),
        cleared: false,
        linkedOccurrenceType: 'bill',
        linkedOccurrenceId: `bill:1:${nextMonthlyDate(date)}`,
        linkedBillOccurrenceId: `bill:1:${nextMonthlyDate(date)}`
      },
      {
        id: 3,
        sequence: 3,
        accountId: 1,
        name: 'Unrelated',
        amount: -10,
        date,
        cleared: true
      }
    ]
  }))
  const debtContainer = await render(Debt)
  const billsContainer = await render(Bills)
  const container = await render(Accounts)
  await click(container.querySelector('[data-account-id="1"]'))
  await click(container.querySelector('[data-transaction-id="1"]'))
  const editDialog = container.querySelector('[role="dialog"]')
  await click(button(editDialog, 'Delete Transaction'))
  const confirmation = container.querySelector('[aria-labelledby="delete-transaction-title"]')
  assert.match(confirmation.textContent, /bill payment/)
  assert.match(confirmation.textContent, /debt payment/)
  await click(button(confirmation, 'Delete'))

  const accountData = readAccountData()
  const billData = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  const debt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.deepEqual(accountData.transactions.map(item => item.id), [2, 3])
  assert.deepEqual(billData.bills[0].paymentHistory.map(entry => entry.dueDate), [nextMonthlyDate(date)])
  assert.equal(debt.currentBalance, 200)
  assert.equal(debt.paymentHistory.length, 1)
  assert.ok(debt.paymentHistory[0].reversedAt)
  assert.ok(billsContainer.querySelector('[aria-label="Bill row: Auto loan"]'))
  assert.ok(button(billsContainer, 'Pay Auto loan'))
  assert.match(debtContainer.querySelector('[aria-label="Debt row: Auto loan"]').textContent, /\$200\.00/)
})

test('deleting a linked income transaction restores only that occurrence to Not Received', async () => {
  seedData({ recurringIncome: true })
  const date = localDate()
  const occurrenceId = `income:2:${date}`
  const savedBills = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  savedBills.incomes[0].paymentHistory = [
    { dueDate: date, status: 'received', transactionId: 1 },
    { dueDate: nextMonthlyDate(date), status: 'received', transactionId: 2 }
  ]
  browser.localStorage.setItem('money-honey-bills', JSON.stringify(savedBills))
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    ...readAccountData(),
    transactions: [
      {
        id: 1,
        sequence: 1,
        accountId: 1,
        name: 'Paycheck',
        amount: 1200,
        date,
        cleared: true,
        linkedOccurrenceType: 'income',
        linkedOccurrenceId: occurrenceId,
        linkedIncomeOccurrenceId: occurrenceId
      },
      {
        id: 2,
        sequence: 2,
        accountId: 1,
        name: 'Paycheck',
        amount: 1200,
        date: nextMonthlyDate(date),
        cleared: false,
        linkedOccurrenceType: 'income',
        linkedOccurrenceId: `income:2:${nextMonthlyDate(date)}`,
        linkedIncomeOccurrenceId: `income:2:${nextMonthlyDate(date)}`
      }
    ]
  }))
  const container = await render(Accounts)
  await click(container.querySelector('[data-account-id="1"]'))
  await click(container.querySelector('[data-transaction-id="1"]'))
  const editDialog = container.querySelector('[role="dialog"]')
  await click(button(editDialog, 'Delete Transaction'))
  const confirmation = container.querySelector('[aria-labelledby="delete-transaction-title"]')
  assert.match(confirmation.textContent, /income receipt/)
  await click(button(confirmation, 'Delete'))
  const billData = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  assert.deepEqual(billData.incomes[0].paymentHistory.map(entry => entry.dueDate), [nextMonthlyDate(date)])
  assert.equal(readAccountData().transactions.length, 1)

  const billsContainer = await render(Bills)
  await click(button(billsContainer, 'Money In'))
  assert.ok(billsContainer.querySelector('[aria-label="Income row: Paycheck"]'))
  assert.ok(button(billsContainer, 'Receive Paycheck'))
})

test('decimal keypads preserve signed balances and expense amounts without rounding', async () => {
  const container = await render(Accounts)
  await click(button(container, 'Add account'))
  await changeValue(container.querySelector('[aria-label="Account name"]'), 'Signed balance')
  const opening = container.querySelector('[aria-label="Opening balance"]')
  assert.equal(opening.inputMode, 'decimal')
  await changeValue(opening, '123.45')
  await click(button(container, 'Toggle opening balance sign'))
  assert.equal(opening.value, '-123.45')
  await submit(opening.closest('form'))
  assert.equal(readAccountData().accounts.find(account => account.name === 'Signed balance').openingBalance, -123.45)
  await click(button(container, 'Manage accounts'))
  const existing = container.querySelector('[aria-label="Opening balance for Signed balance"]')
  assert.equal(existing.inputMode, 'decimal')
  await click(button(container, 'Toggle opening balance sign for Signed balance'))
  assert.equal(readAccountData().accounts.find(account => account.name === 'Signed balance').openingBalance, 123.45)
  await changeValue(existing, '100.')
  assert.equal(existing.value, '100.')
  await changeValue(existing, '100.05')
  assert.equal(existing.value, '100.05')
  assert.equal(readAccountData().accounts.find(account => account.name === 'Signed balance').openingBalance, 100.05)
  await changeValue(existing, '100.055')
  assert.equal(readAccountData().accounts.find(account => account.name === 'Signed balance').openingBalance, 100.05)
  await changeValue(existing, '100.05')
  await click(button(container, 'Done'))
  await click(buttonContaining(container, 'Checking'))
  await click(button(container, 'Add transaction'))
  const form = container.querySelector('[role="dialog"] form')
  const amount = form.querySelector('[aria-label="Amount"]')
  assert.equal(amount.inputMode, 'decimal')
  assert.equal(amount.hasAttribute('min'), false)
  await changeValue(form.querySelector('[aria-label="Payee or description"]'), 'Decimal expense')
  await changeValue(form.querySelector('[aria-label="Transaction type"]'), 'expense')
  await changeValue(amount, '-12.34')
  await submit(form)
  assert.equal(readAccountData().transactions.find(transaction => transaction.name === 'Decimal expense').amount, -12.34)
})

test('bill day fields use integer keypads while amounts use decimal keypads', async () => {
  const container = await render(Bills)
  await click(button(container, 'Add bill'))
  const form = container.querySelector('form')
  assert.equal(form.querySelector('[aria-label="Amount"]').inputMode, 'decimal')
  assert.equal(form.querySelector('[aria-label="Bill name"]').inputMode, '')
  await changeValue(form.querySelector('[aria-label="Frequency"]'), 'twice-monthly')
  for (const label of ['First day of month', 'Second day of month']) {
    assert.equal(form.querySelector(`[aria-label="${label}"]`).inputMode, 'numeric')
  }
})

test('Debt card opens read-only details and Edit Debt opens the compact form', async () => {
  const nextPaymentDue = shiftDate(localDate(), 1)
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({
    version: 1,
    debts: [{
      id: 21,
      name: 'Student loan',
      type: 'Personal Loan',
      startingBalance: 1000,
      currentBalance: 700,
      interestRate: 4.5,
      minimumPayment: 75,
      nextPaymentDue,
      paymentHistory: []
    }]
  }))
  const container = await render(Debt)
  const card = container.querySelector('[aria-label="Debt row: Student loan"]')
  assert.match(card.textContent, /Personal Loan/)
  assert.match(card.textContent, /\$700\.00/)
  assert.match(card.textContent, /\$75\.00/)
  assert.match(card.textContent, new RegExp(displayDate(nextPaymentDue)))
  assert.match(card.textContent, /70% left/)
  assert.equal(card.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '30')

  await click(card)
  const details = container.querySelector('[aria-label="Student loan debt details"]')
  assert.ok(details)
  assert.equal(container.querySelector('[aria-label="Edit debt form"]'), null)
  assert.match(details.textContent, /Outstanding Balance/)
  assert.match(details.textContent, /Starting Balance/)
  assert.match(details.textContent, /Minimum Payment/)
  assert.match(details.textContent, /Next Payment Due/)
  assert.match(details.textContent, /Payoff Progress/)
  assert.doesNotMatch(details.textContent, /Percentage remaining/)
  assert.equal(details.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '30')
  assert.match(details.textContent, /4\.5%/)
  assert.match(details.textContent, /No payments recorded/)
  assert.equal(details.querySelectorAll('button').length, 2)

  await click(button(details, 'Edit Debt'))
  const form = container.querySelector('[aria-label="Edit debt form"] form')
  assert.ok(form)
  assert.equal(form.querySelector('h3'), null)
  assert.equal(form.textContent.includes('Payment History'), false)
  assert.equal(form.querySelector('[aria-label="Next Payment Due"]').type, 'date')
  assert.equal(form.querySelectorAll('input[type="number"]').length, 0)
  assert.equal(form.querySelector('[aria-label="Current balance · amount still owed"]').inputMode, 'decimal')
})

test('linked debt bill payment immediately advances next due date and keeps scheduled and actual dates distinct', async () => {
  seedData({ recurring: true })
  const scheduledDueDate = localDate()
  const actualPaymentDate = shiftDate(scheduledDueDate, -1)
  const nextDueDate = nextMonthlyDate(scheduledDueDate)
  const savedBills = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  savedBills.bills[0] = {
    ...savedBills.bills[0],
    name: 'Auto loan',
    amount: 24,
    dueDate: scheduledDueDate,
    frequency: 'monthly',
    debtId: 8,
    debtManaged: true
  }
  browser.localStorage.setItem('money-honey-bills', JSON.stringify(savedBills))
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({
    version: 1,
    debts: [{
      id: 8,
      name: 'Auto loan',
      type: 'Auto Loan',
      startingBalance: 200,
      currentBalance: 100,
      interestRate: 0,
      minimumPayment: 24,
      nextPaymentDue: scheduledDueDate,
      paymentCalculationMethod: 'principal-only',
      billId: 1,
      paymentHistory: []
    }]
  }))

  const debtContainer = await render(Debt)
  const debtRow = debtContainer.querySelector('[aria-label="Debt row: Auto loan"]')
  assert.match(debtRow.textContent, /Due Today/)

  const billsContainer = await render(Bills)
  await click(button(billsContainer, 'Pay Auto loan'))
  const paymentDialog = billsContainer.querySelector('[role="dialog"]')
  await changeValue(paymentDialog.querySelector('[aria-label="Actual payment date"]'), actualPaymentDate)
  await click(button(paymentDialog, 'Confirm'))

  const updatedDebt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  const updatedBills = JSON.parse(browser.localStorage.getItem('money-honey-bills')).bills
  assert.equal(updatedDebt.paymentHistory[0].date, actualPaymentDate)
  assert.equal(updatedDebt.paymentHistory[0].scheduledDueDate, scheduledDueDate)
  assert.equal(updatedBills.find(bill => bill.id === 1).dueDate, scheduledDueDate)
  assert.match(debtRow.textContent, new RegExp(`Due ${displayDate(nextDueDate)}`))
  assert.doesNotMatch(debtRow.textContent, /Past Due/)

  await click(debtRow)
  const details = debtContainer.querySelector('[aria-label="Auto loan debt details"]')
  assert.match(details.textContent, new RegExp(`Next Payment Due${displayDate(nextDueDate)}`))
  assert.match(details.textContent, new RegExp(`Paid ${displayDate(actualPaymentDate)}`))
  const paymentHistory = details.querySelector('h3 + div')
  assert.match(paymentHistory.textContent, new RegExp(`Paid ${displayDate(actualPaymentDate)}`))
  assert.doesNotMatch(paymentHistory.textContent, /Due /)

  await click(billsContainer.querySelector('[aria-label="Show Completed"]'))
  await click(button(billsContainer, 'Paid Auto loan'))
  assert.match(debtRow.textContent, /Due Today/)
  assert.doesNotMatch(debtRow.textContent, /Past Due/)
  assert.equal(readAccountData().transactions.length, 0)
})

test('Debt card and details show the oldest unpaid overdue installment and combined overdue amount', async () => {
  seedData({ recurring: true })
  const today = localDate()
  const firstDueDate = shiftDate(today, -75)
  const savedBills = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  savedBills.bills[0] = {
    ...savedBills.bills[0],
    name: 'Auto loan',
    amount: 24,
    dueDate: firstDueDate,
    frequency: 'monthly',
    debtId: 8,
    debtManaged: true
  }
  browser.localStorage.setItem('money-honey-bills', JSON.stringify(savedBills))
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({
    version: 1,
    debts: [{
      id: 8,
      name: 'Auto loan',
      type: 'Auto Loan',
      startingBalance: 200,
      currentBalance: 100,
      interestRate: 0,
      minimumPayment: 24,
      nextPaymentDue: firstDueDate,
      paymentCalculationMethod: 'principal-only',
      billId: 1,
      paymentHistory: []
    }]
  }))

  const container = await render(Debt)
  const debtRow = container.querySelector('[aria-label="Debt row: Auto loan"]')
  const overdueIndicator = [...debtRow.querySelectorAll('span')]
    .find(element => element.textContent.includes('Past Due'))
  assert.ok(overdueIndicator)
  assert.match(overdueIndicator.textContent, new RegExp(`Past Due since ${displayDate(firstDueDate)}`))
  assert.match(overdueIndicator.textContent, /\$72\.00 overdue/)

  await click(debtRow)
  const details = container.querySelector('[aria-label="Auto loan debt details"]')
  const detailStatus = details.querySelector('[role="status"]')
  assert.ok(detailStatus)
  assert.match(detailStatus.textContent, new RegExp(`Past Due since ${displayDate(firstDueDate)}`))
  assert.match(detailStatus.textContent, /\$72\.00 overdue/)
})

test('skipping one debt installment hides it from default List, updates debt due date, and can be undone', async () => {
  seedData({ recurring: true })
  const scheduledDueDate = localDate()
  const nextDueDate = nextMonthlyDate(scheduledDueDate)
  const savedBills = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  savedBills.bills[0] = {
    ...savedBills.bills[0],
    name: 'Auto loan',
    amount: 24,
    dueDate: scheduledDueDate,
    frequency: 'monthly',
    debtId: 8,
    debtManaged: true
  }
  browser.localStorage.setItem('money-honey-bills', JSON.stringify(savedBills))
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({
    version: 1,
    debts: [{
      id: 8,
      name: 'Auto loan',
      type: 'Auto Loan',
      startingBalance: 200,
      currentBalance: 100,
      interestRate: 0,
      minimumPayment: 24,
      nextPaymentDue: scheduledDueDate,
      paymentCalculationMethod: 'principal-only',
      billId: 1,
      paymentHistory: []
    }]
  }))

  const debtContainer = await render(Debt)
  const debtRow = debtContainer.querySelector('[aria-label="Debt row: Auto loan"]')
  const billsContainer = await render(Bills)
  const billRow = billsContainer.querySelector('[aria-label="Bill row: Auto loan"]')
  assert.ok(billRow)
  assert.equal([...billRow.querySelectorAll('button')].some(item =>
    item.textContent.includes('Skip')
  ), false)
  await click(billRow)
  let editDialog = billsContainer.querySelector('[role="dialog"]')
  assert.ok(button(editDialog, 'Skip This Payment'))

  let confirmation = ''
  browser.confirm = message => {
    confirmation = message
    return false
  }
  await click(button(editDialog, 'Skip This Payment'))
  assert.match(confirmation, new RegExp(displayDate(scheduledDueDate)))
  assert.match(confirmation, /\$24\.00/)
  assert.match(confirmation, /internal planning status/)
  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-bills')).bills[0].paymentHistory.length, 0)

  browser.confirm = () => true
  await click(button(editDialog, 'Skip This Payment'))
  assert.ok(button(editDialog, 'Undo Skip'))
  const skippedDate = displayDate(scheduledDueDate)
  const visibleBillRows = [...billsContainer.querySelectorAll('[aria-label="Bill row: Auto loan"]')]
  assert.ok(visibleBillRows.every(row => !row.textContent.includes(skippedDate)))
  assert.match(debtRow.textContent, new RegExp(`Due ${displayDate(nextDueDate)}`))
  assert.doesNotMatch(debtRow.textContent, /Past Due/)

  let data = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  const bill = data.bills.find(item => item.id === 1)
  assert.equal(bill.dueDate, scheduledDueDate)
  assert.equal(bill.paymentHistory.length, 1)
  assert.equal(bill.paymentHistory[0].skipped, true)
  assert.equal(readAccountData().transactions.length, 0)
  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0].currentBalance, 100)

  await click(button(editDialog, 'Cancel'))
  await click(button(billsContainer, 'Calendar'))
  const calendarOccurrence = billsContainer.querySelector('[aria-label="Bill row: Auto loan"]')
  assert.ok(calendarOccurrence)
  assert.match(calendarOccurrence.textContent, /Skipped/)
  assert.equal([...calendarOccurrence.querySelectorAll('button')].some(item =>
    item.textContent.includes('Skip')
  ), false)
  await click(calendarOccurrence)
  editDialog = billsContainer.querySelector('[role="dialog"]')
  assert.ok(button(editDialog, 'Undo Skip'))
  await click(button(editDialog, 'Cancel'))

  await click(button(billsContainer, 'List'))
  await click(billsContainer.querySelector('[aria-label="Show Completed"]'))
  const completedRow = billsContainer.querySelector('[aria-label="Bill row: Auto loan"]')
  assert.ok(completedRow)
  assert.match(completedRow.textContent, /Skipped/)
  await click(completedRow)
  editDialog = billsContainer.querySelector('[role="dialog"]')
  await click(button(editDialog, 'Undo Skip'))

  assert.match(debtRow.textContent, /Due Today/)
  assert.doesNotMatch(debtRow.textContent, /Past Due/)
  assert.equal(readAccountData().transactions.length, 0)
  data = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  assert.equal(data.bills[0].paymentHistory.length, 2)
  assert.equal(data.bills[0].paymentHistory[1].skipped, false)
  assert.equal(data.bills[0].dueDate, scheduledDueDate)
  await click(debtRow)
  const details = debtContainer.querySelector('[aria-label="Auto loan debt details"]')
  assert.match(details.textContent, /Skipped/)
  assert.match(details.textContent, new RegExp(displayDate(scheduledDueDate)))
})

test('editing a legacy credit card adds metadata without reinterpreting names, balances or history', async () => {
  const legacy = {
    id: 8, name: 'E Visa 0042', type: 'Credit Card', startingBalance: 2000, currentBalance: 1500.25,
    paymentHistory: [{ id: 'old-payment', total: 499.75, principal: 499.75, date: localDate() }]
  }
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({ version: 1, debts: [legacy] }))
  const accountsBefore = browser.localStorage.getItem('money-honey-account-data')
  const container = await render(Debt)
  const row = () => container.querySelector('[aria-label="Debt row: E Visa 0042"]')
  assert.doesNotMatch(row().textContent, /••/)
  await click(row())
  await click(button(container, 'Edit Debt'))
  let form = container.querySelector('form')
  assert.equal(form.querySelector('[aria-label="Starting balance · original amount borrowed or owed"]'), null)
  assert.equal(form.querySelector('[aria-label="Credit Limit"]').value, '')
  assert.equal(form.querySelector('[aria-label="Account Last 4 Digits"]').value, '')
  assert.equal(form.querySelector('[aria-label="Assigned To"]').value, '')
  assert.deepEqual([...form.querySelector('[aria-label="Assigned To"]').options].map(option => option.value), ['', 'E', 'R', 'Joint'])
  assert.equal(form.querySelector('[aria-label="Custom Assignee"]'), null)
  const last4 = form.querySelector('[aria-label="Account Last 4 Digits"]')
  assert.equal(last4.type, 'text')
  assert.equal(last4.inputMode, 'numeric')
  await changeValue(last4, '012')
  await submit(form)
  assert.match(form.textContent, /exactly four digits/)
  await changeValue(last4, '0012')
  await changeValue(form.querySelector('[aria-label="Credit Limit"]'), '5000')
  await click(button(form, 'Manage Assignees'))
  const manager = container.querySelector('[aria-label="Manage Assignees"]')
  await changeValue(manager.querySelector('[aria-label="New assignee name"]'), 'Household')
  await submit(manager.querySelector('form'))
  await click(button(manager, 'Done'))
  form = container.querySelector('form')
  assert.equal(form.querySelector('[aria-label="Debt name"]').value, 'E Visa 0042')
  assert.equal(form.querySelector('[aria-label="Credit Limit"]').value, '5000')
  await changeValue(form.querySelector('[aria-label="Assigned To"]'), 'Household')
  await submit(form)
  const saved = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(saved.name, legacy.name)
  assert.equal(saved.startingBalance, 2000)
  assert.equal(saved.currentBalance, 1500.25)
  assert.deepEqual(saved.paymentHistory, legacy.paymentHistory)
  assert.equal(saved.accountLast4, '0012')
  assert.equal(saved.creditLimit, 5000)
  assert.equal(saved.assignedTo, 'Household')
  assert.equal(Object.hasOwn(saved, 'customAssignee'), false)
  assert.match(row().textContent, /••0012.*Household/)
  await click(row())
  assert.match(container.querySelector('[role="dialog"]').textContent, /Available Credit\$3,499\.75/)
  assert.match(container.querySelector('[role="dialog"]').textContent, /Account Last 4 Digits••0012/)
  await click(button(container, 'Edit Debt'))
  form = container.querySelector('form')
  await changeValue(form.querySelector('[aria-label="Credit Limit"]'), '6000')
  await changeValue(form.querySelector('[aria-label="Assigned To"]'), '')
  await changeValue(form.querySelector('[aria-label="Account Last 4 Digits"]'), '')
  await submit(form)
  assert.doesNotMatch(row().textContent, /Household|••/)
  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0].startingBalance, 2000)
  assert.equal(browser.localStorage.getItem('money-honey-account-data'), accountsBefore)
})

test('assignee manager renames defaults, rejects duplicates, confirms affected counts, and persists deletion', async () => {
  const debts = [
    { id: 1, name: 'Active', startingBalance: 1000, currentBalance: 800, assignedTo: 'E', paymentHistory: [{ id: 'payment', total: 200, principal: 200 }] },
    { id: 2, name: 'Archived', startingBalance: 500, currentBalance: 400, assignedTo: 'E', archived: true, paymentHistory: [] },
    { id: 3, name: 'Unassigned', startingBalance: 300, currentBalance: 100, paymentHistory: [] }
  ]
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({ version: 1, debts }))
  const otherKeys = ['money-honey-account-data', 'money-honey-bills']
  const before = otherKeys.map(key => browser.localStorage.getItem(key))
  let container = await render(Debt)
  assert.equal([...container.querySelectorAll('button')].some(item => item.textContent === 'Manage Assignees'), false)
  await openManualDebt(container)
  const form = container.querySelector('[aria-label="Add debt form"] form')
  const initialSelect = form.querySelector('[aria-label="Assigned To"]')
  const manageButton = button(form, 'Manage Assignees')
  assert.equal(initialSelect.value, '')
  assert.equal(initialSelect.closest('label').nextElementSibling, manageButton)
  const draft = {
    'Debt name': 'Draft card',
    'Account Last 4 Digits': '0012',
    'Credit Limit': '5000.25',
    'Current balance · amount still owed': '800.15',
    'Interest rate · annual percentage (optional)': '4.5',
    'Minimum payment · amount due each cycle (optional)': '99.25',
    'Next Payment Due': localDate()
  }
  for (const [label, value] of Object.entries(draft)) {
    await changeValue(form.querySelector(`[aria-label="${label}"]`), value)
  }
  await click(manageButton)
  let manager = container.querySelector('[aria-label="Manage Assignees"]')
  await click(button(manager, 'Rename assignee E'))
  await changeValue(manager.querySelector('[aria-label="Assignee name"]'), 'Primary')
  await submit(manager.querySelector('form'))
  assert.equal(manager.querySelector('[aria-label="Rename assignee E"]'), null)
  assert.ok(manager.querySelector('[aria-label="Rename assignee Primary"]'))
  assert.match(container.querySelector('[aria-label="Debt row: Active"]').textContent, /Primary/)
  const renamed = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts
  assert.deepEqual(renamed, debts.map(debt => debt.assignedTo === 'E' ? { ...debt, assignedTo: 'Primary' } : debt))
  const afterRename = browser.localStorage.getItem('money-honey-debts')
  await changeValue(manager.querySelector('[aria-label="New assignee name"]'), ' primary ')
  await submit(manager.querySelector('form'))
  assert.match(manager.querySelector('[role="alert"]').textContent, /already exists/)
  assert.equal(browser.localStorage.getItem('money-honey-debts'), afterRename)
  let confirmation = ''
  browser.confirm = message => { confirmation = message; return false }
  await click(button(manager, 'Delete assignee Primary'))
  assert.match(confirmation, /2 debts will be set to Unassigned/)
  assert.match(confirmation, /No debts, balances, or payment histories/)
  assert.equal(browser.localStorage.getItem('money-honey-debts'), afterRename)
  browser.confirm = () => true
  await click(button(manager, 'Delete assignee Primary'))
  const cleared = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts
  assert.deepEqual(cleared, renamed.map(debt => debt.assignedTo === 'Primary' ? { ...debt, assignedTo: '' } : debt))
  await click(button(manager, 'Delete assignee R'))
  await click(button(manager, 'Delete assignee Joint'))
  assert.match(manager.textContent, /No assignees/)
  await click(button(manager, 'Done'))
  const returnedForm = container.querySelector('[aria-label="Add debt form"] form')
  for (const [label, value] of Object.entries(draft)) {
    assert.equal(returnedForm.querySelector(`[aria-label="${label}"]`).value, value)
  }
  assert.equal(returnedForm.querySelector('[aria-label="Assigned To"]').value, '')
  container = await reload(Debt, container)
  assert.equal([...container.querySelectorAll('button')].some(item => item.textContent === 'Manage Assignees'), false)
  await openManualDebt(container)
  const select = container.querySelector('[aria-label="Assigned To"]')
  assert.deepEqual([...select.options].map(option => option.value), [''])
  assert.equal(select.value, '')
  await click(button(container.querySelector('form'), 'Manage Assignees'))
  manager = container.querySelector('[aria-label="Manage Assignees"]')
  await changeValue(manager.querySelector('[aria-label="New assignee name"]'), 'Household')
  await submit(manager.querySelector('form'))
  await click(button(manager, 'Done'))
  const refreshedSelect = container.querySelector('[aria-label="Assigned To"]')
  assert.equal(refreshedSelect.value, '')
  assert.deepEqual([...refreshedSelect.options].map(option => option.value), ['', 'Household'])
  assert.deepEqual(otherKeys.map(key => browser.localStorage.getItem(key)), before)
})

test('managing an edited debt updates its unsaved selection and keeps the remaining form draft', async () => {
  const legacy = {
    id: 1, name: 'Legacy card', type: 'Credit Card', startingBalance: 1000, currentBalance: 800,
    assignedTo: 'Other', customAssignee: 'Household', paymentHistory: []
  }
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({ version: 1, debts: [legacy] }))
  const container = await render(Debt)
  await click(container.querySelector('[aria-label="Debt row: Legacy card"]'))
  await click(button(container, 'Edit Debt'))
  let form = container.querySelector('form')
  const assignedTo = form.querySelector('[aria-label="Assigned To"]')
  assert.equal(assignedTo.value, 'Household')
  assert.equal(assignedTo.closest('label').nextElementSibling, button(form, 'Manage Assignees'))
  assert.equal(form.querySelector('[aria-label="Custom Assignee"]'), null)
  await changeValue(form.querySelector('[aria-label="Credit Limit"]'), '5000')
  await click(button(form, 'Manage Assignees'))
  let manager = container.querySelector('[aria-label="Manage Assignees"]')
  await click(button(manager, 'Rename assignee Household'))
  await changeValue(manager.querySelector('[aria-label="Assignee name"]'), 'Family')
  await submit(manager.querySelector('form'))
  await click(button(manager, 'Done'))
  form = container.querySelector('form')
  assert.equal(form.querySelector('[aria-label="Credit Limit"]').value, '5000')
  assert.equal(form.querySelector('[aria-label="Assigned To"]').value, 'Family')
  await click(button(form, 'Manage Assignees'))
  manager = container.querySelector('[aria-label="Manage Assignees"]')
  await click(button(manager, 'Delete assignee Family'))
  await click(button(manager, 'Done'))
  form = container.querySelector('form')
  assert.equal(form.querySelector('[aria-label="Assigned To"]').value, '')
  await submit(form)
  const saved = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.deepEqual(saved.paymentHistory, legacy.paymentHistory)
  assert.equal(saved.currentBalance, 800)
  assert.equal(saved.creditLimit, 5000)
  assert.equal(saved.assignedTo, '')
  assert.equal(Object.hasOwn(saved, 'customAssignee'), false)
})

test('new credit cards start payoff tracking from the outstanding balance, never the limit', async () => {
  const container = await render(Debt)
  await openManualDebt(container)
  const form = container.querySelector('form')
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'New card')
  await changeValue(form.querySelector('[aria-label="Debt type"]'), 'Auto Loan')
  assert.ok(form.querySelector('[aria-label="Starting balance · original amount borrowed or owed"]'))
  assert.equal(form.querySelector('[aria-label="Credit Limit"]'), null)
  await changeValue(form.querySelector('[aria-label="Debt type"]'), 'Credit Card')
  assert.equal(form.querySelector('[aria-label="Credit Limit"]').required, false)
  await changeValue(form.querySelector('[aria-label="Credit Limit"]'), '5000.25')
  await changeValue(form.querySelector('[aria-label="Current balance · amount still owed"]'), '800.15')
  await changeValue(form.querySelector('[aria-label="Assigned To"]'), 'Joint')
  assert.match(form.textContent, /Available credit: \$4,200\.10/)
  await submit(form)
  const saved = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(saved.startingBalance, 800.15)
  assert.equal(saved.currentBalance, 800.15)
  assert.equal(saved.creditLimit, 5000.25)
  assert.equal(saved.assignedTo, 'Joint')
  assert.match(container.querySelector('[aria-label="Debt row: New card"]').textContent, /Joint/)
})

test('Debt edits create and update one monthly bill; Bills records and reverses the payment', async () => {
  let debtContainer = await render(Debt)
  await openManualDebt(debtContainer)
  let form = debtContainer.querySelector('[aria-label="Add debt form"] form')
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'Auto loan')
  await changeValue(form.querySelector('[aria-label="Debt type"]'), 'Auto Loan')
  await changeValue(form.querySelector('[aria-label="Starting balance · original amount borrowed or owed"]'), '1000')
  await changeValue(form.querySelector('[aria-label="Current balance · amount still owed"]'), '1000')
  await changeValue(form.querySelector('[aria-label="Minimum payment · amount due each cycle (optional)"]'), '100')
  await changeValue(form.querySelector('[aria-label="Next Payment Due"]'), localDate())
  await submit(form)

  assert.ok(debtContainer.querySelector('[aria-label="Debt row: Auto loan"]'))
  let savedDebt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  let billData = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  let linkedBill = billData.bills.find(bill => bill.debtId === savedDebt.id)
  assert.ok(linkedBill)
  assert.equal(linkedBill.frequency, 'monthly')
  assert.equal(linkedBill.amount, 100)
  assert.equal(linkedBill.dueDate, localDate())
  assert.equal(billData.bills.filter(bill => bill.debtId === savedDebt.id).length, 1)
  assert.equal(debtContainer.querySelector('[aria-label="Record debt payment"]'), null)

  debtContainer = await reload(Debt, debtContainer)
  billData = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  assert.equal(billData.bills.filter(bill => bill.debtId === savedDebt.id).length, 1)

  await click(debtContainer.querySelector('[aria-label="Debt row: Auto loan"]'))
  assert.ok(debtContainer.querySelector('[aria-label="Auto loan debt details"]'))
  assert.equal(debtContainer.querySelector('[aria-label="Edit debt form"]'), null)
  await click(button(debtContainer.querySelector('[role="dialog"]'), 'Edit Debt'))
  form = debtContainer.querySelector('[aria-label="Edit debt form"] form')
  await changeValue(form.querySelector('[aria-label="Minimum payment · amount due each cycle (optional)"]'), '125')
  const nextDueDate = new Date(`${localDate()}T00:00:00`)
  nextDueDate.setMonth(nextDueDate.getMonth() + 1)
  const dueDate = `${nextDueDate.getFullYear()}-${String(nextDueDate.getMonth() + 1).padStart(2, '0')}-${String(nextDueDate.getDate()).padStart(2, '0')}`
  await changeValue(form.querySelector('[aria-label="Next Payment Due"]'), dueDate)
  await submit(form)

  billData = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  linkedBill = billData.bills.find(bill => bill.debtId === savedDebt.id)
  assert.equal(linkedBill.amount, 125)
  assert.equal(linkedBill.dueDate, dueDate)
  assert.equal(billData.bills.filter(bill => bill.debtId === savedDebt.id).length, 1)

  const billsContainer = await render(Bills)
  await click(button(billsContainer, 'Pay Auto loan'))
  const paymentDialog = billsContainer.querySelector('[role="dialog"]')
  assert.ok(paymentDialog.querySelector('[aria-label="Payment account"]'))
  await changeValue(paymentDialog.querySelector('[aria-label="Payment account"]'), '1')
  await changeValue(paymentDialog.querySelector('[aria-label="Actual payment date"]'), localDate())
  await click(button(paymentDialog, 'Confirm'))

  let accountData = readAccountData()
  savedDebt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(accountData.transactions.length, 1)
  assert.equal(accountData.transactions[0].amount, -125)
  assert.equal(accountData.transactions[0].cleared, false)
  assert.equal(accountData.transactions[0].linkedDebtId, savedDebt.id)
  assert.equal(savedDebt.currentBalance, 875)
  assert.equal(savedDebt.paymentHistory.length, 1)
  assert.equal(savedDebt.paymentHistory[0].date, localDate())
  assert.equal(savedDebt.paymentHistory[0].scheduledDueDate, dueDate)
  assert.equal(savedDebt.paymentHistory[0].billOccurrenceId, `bill:${savedDebt.billId}:${dueDate}`)

  await click(debtContainer.querySelector('[aria-label="Debt row: Auto loan"]'))
  const details = debtContainer.querySelector('[aria-label="Auto loan debt details"]')
  assert.ok(details)
  assert.match(details.textContent, /Uncleared/)
  assert.match(details.textContent, /\$125\.00/)
  const paymentHistory = details.querySelector('h3 + div')
  assert.match(paymentHistory.textContent, new RegExp(`Paid ${displayDate(localDate())}`))
  assert.match(paymentHistory.textContent, /Uncleared/)
  assert.doesNotMatch(paymentHistory.textContent, /Due /)
  assert.equal(details.querySelectorAll('button').length, 2)
  accountData.transactions[0].cleared = true
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify(accountData))
  await act(async () => browser.dispatchEvent(new browser.Event('money-honey-accounts-updated')))
  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0].currentBalance, 875)
  assert.match(debtContainer.querySelector('[aria-label="Auto loan debt details"]').textContent, /Cleared/)
  await click(button(debtContainer.querySelector('[aria-label="Auto loan debt details"]'), 'Edit Debt'))
  form = debtContainer.querySelector('[aria-label="Edit debt form"] form')
  await changeValue(form.querySelector('[aria-label="Minimum payment · amount due each cycle (optional)"]'), '150')
  const laterDue = new Date(`${dueDate}T00:00:00`)
  laterDue.setMonth(laterDue.getMonth() + 1)
  const laterDueDate = `${laterDue.getFullYear()}-${String(laterDue.getMonth() + 1).padStart(2, '0')}-${String(laterDue.getDate()).padStart(2, '0')}`
  await changeValue(form.querySelector('[aria-label="Next Payment Due"]'), laterDueDate)
  await submit(form)

  accountData = readAccountData()
  billData = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  linkedBill = billData.bills.find(bill => bill.debtId === savedDebt.id)
  assert.equal(linkedBill.amount, 150)
  assert.equal(linkedBill.dueDate, dueDate)
  assert.match(debtContainer.querySelector('[aria-label="Debt row: Auto loan"]').textContent, new RegExp(displayDate(laterDueDate)))
  assert.equal(linkedBill.paymentHistory.length, 1)
  assert.equal(accountData.transactions[0].amount, -125)
  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0].paymentHistory.length, 1)

  await click(billsContainer.querySelector('[aria-label="Show Completed"]'))
  await click(button(billsContainer, 'Paid Auto loan'))
  assert.equal(readAccountData().transactions.length, 0)
  savedDebt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(savedDebt.currentBalance, 1000)
  assert.equal(savedDebt.paymentHistory.length, 1)
  assert.ok(savedDebt.paymentHistory[0].reversedAt)
})

test('Paying a linked bill reuses its transaction, updates principal automatically, and reverses both records', async () => {
  const recurringBills = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  recurringBills.bills[0].frequency = 'monthly'
  recurringBills.bills[0].amount = 24
  browser.localStorage.setItem('money-honey-bills', JSON.stringify(recurringBills))
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({
    version: 1,
    debts: [{
      id: 8,
      name: 'Auto loan',
      type: 'Auto Loan',
      startingBalance: 200,
      currentBalance: 100,
      interestRate: 35,
      paymentCalculationMethod: 'principal-only',
      accountId: 1,
      billId: 1,
      paymentHistory: []
    }]
  }))
  const savedBills = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  savedBills.bills[0].debtId = 8
  browser.localStorage.setItem('money-honey-bills', JSON.stringify(savedBills))

  const container = await render(Bills)
  await click(button(container, 'Pay Electric'))
  const paymentDialog = container.querySelector('[role="dialog"]')
  await click(button(paymentDialog, 'Confirm'))

  let accountData = readAccountData()
  let debt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(accountData.transactions.length, 1)
  assert.equal(accountData.transactions[0].amount, -24)
  assert.equal(accountData.transactions[0].linkedOccurrenceId, `bill:1:${localDate()}`)
  assert.equal(accountData.transactions[0].linkedDebtId, 8)
  assert.equal(debt.currentBalance, 76)
  assert.equal(debt.paymentHistory.length, 1)

  for (const cleared of [true, false]) {
    accountData.transactions[0].cleared = cleared
    browser.localStorage.setItem('money-honey-account-data', JSON.stringify(accountData))
    debt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
    assert.equal(debt.currentBalance, 76)
    assert.equal(debt.paymentHistory.length, 1)
  }
  debt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(debt.currentBalance, 76)
  assert.equal(debt.paymentHistory.length, 1)

  await click(container.querySelector('[aria-label="Show Completed"]'))
  await click(button(container, 'Paid Electric'))
  assert.equal(readAccountData().transactions.length, 0)
  debt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(debt.currentBalance, 100)
  assert.equal(debt.paymentHistory.length, 1)
  assert.ok(debt.paymentHistory[0].reversedAt)
})

test('Credit-card debt card opens the edit form directly with no payment management UI', async () => {
  const accountData = readAccountData()
  accountData.accounts.push({
    id: 2,
    name: 'Store Card',
    type: 'Credit Card',
    openingBalance: 500,
    openingDate: localDate(),
    archived: false
  })
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify(accountData))

  const container = await render(Debt)
  await openManualDebt(container)
  const form = container.querySelector('[aria-label="Add debt form"] form')
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'Store card debt')
  await changeValue(form.querySelector('[aria-label="Debt type"]'), 'Credit Card')
  await changeValue(form.querySelector('[aria-label="Credit Limit"]'), '5000')
  await changeValue(form.querySelector('[aria-label="Current balance · amount still owed"]'), '500')
  await changeValue(form.querySelector('[aria-label="Interest rate · annual percentage (optional)"]'), '18')
  await changeValue(form.querySelector('[aria-label="Minimum payment · amount due each cycle (optional)"]'), '100')
  await changeValue(form.querySelector('[aria-label="Next Payment Due"]'), localDate())
  await submit(form)

  await click(container.querySelector('[aria-label="Debt row: Store card debt"]'))
  const details = container.querySelector('[aria-label="Store card debt debt details"]')
  assert.ok(details)
  assert.equal(container.querySelector('[aria-label="Record debt payment"]'), null)
  assert.equal(details.querySelectorAll('button').length, 2)
  await click(button(details, 'Edit Debt'))
  assert.ok(container.querySelector('[aria-label="Edit debt form"]'))
  await click(button(container.querySelector('[aria-label="Edit debt form"]'), 'Cancel'))

  const billsContainer = await render(Bills)
  await click(button(billsContainer, 'Pay Store card debt'))
  const paymentDialog = billsContainer.querySelector('[role="dialog"]')
  await changeValue(paymentDialog.querySelector('[aria-label="Payment account"]'), '1')
  await click(button(paymentDialog, 'Confirm'))

  const saved = readAccountData()
  const debt = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts[0]
  assert.equal(saved.transactions.length, 1)
  assert.equal(saved.transactions[0].amount, -100)
  assert.equal(saved.transactions[0].transactionType, 'debt-payment')
  assert.equal(debt.currentBalance, 500)
  assert.equal(debt.paymentHistory[0].principal, 0)

  await click(container.querySelector('[aria-label="Debt row: Store card debt"]'))
  await click(button(container.querySelector('[aria-label="Store card debt debt details"]'), 'Edit Debt'))
  await click(button(container.querySelector('[aria-label="Edit debt form"]'), 'Archive Debt'))
  assert.equal(container.querySelector('[aria-label="Debt row: Store card debt"]'), null)
  await click(container.querySelector('[aria-label="Show Archived Debts"]'))
  await click(container.querySelector('[aria-label="Debt row: Store card debt"]'))
  await click(button(container.querySelector('[aria-label="Store card debt debt details"]'), 'Edit Debt'))
  await click(button(container.querySelector('[aria-label="Edit debt form"]'), 'Restore Debt'))
  assert.ok(container.querySelector('[aria-label="Debt row: Store card debt"]'))
})

test('Debt links a matching monthly bill instead of duplicating its schedule', async () => {
  const savedBills = JSON.parse(browser.localStorage.getItem('money-honey-bills'))
  savedBills.bills[0] = {
    ...savedBills.bills[0],
    name: 'Auto loan',
    amount: 100,
    dueDate: localDate(),
    frequency: 'monthly'
  }
  browser.localStorage.setItem('money-honey-bills', JSON.stringify(savedBills))
  const container = await render(Debt)
  await openManualDebt(container)
  const form = container.querySelector('[aria-label="Add debt form"] form')
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'Auto loan')
  await changeValue(form.querySelector('[aria-label="Debt type"]'), 'Auto Loan')
  await changeValue(form.querySelector('[aria-label="Starting balance · original amount borrowed or owed"]'), '1000')
  await changeValue(form.querySelector('[aria-label="Current balance · amount still owed"]'), '1000')
  await changeValue(form.querySelector('[aria-label="Minimum payment · amount due each cycle (optional)"]'), '100')
  await changeValue(form.querySelector('[aria-label="Next Payment Due"]'), localDate())
  await submit(form)

  const debts = JSON.parse(browser.localStorage.getItem('money-honey-debts')).debts
  const bills = JSON.parse(browser.localStorage.getItem('money-honey-bills')).bills
  assert.equal(bills.length, 1)
  assert.equal(bills[0].debtId, debts[0].id)
  assert.equal(debts[0].billId, bills[0].id)
  assert.equal(bills[0].debtManaged, false)
})

test('Debt page displays overall summary with remaining, paid off, progress percent, and progress bar above cards', async () => {
  seedData()
  const date = localDate()
  browser.localStorage.setItem('money-honey-debts', JSON.stringify({
    version: 1,
    debts: [
      {
        id: 1,
        name: 'Auto loan',
        type: 'Auto Loan',
        startingBalance: 1000,
        currentBalance: 400,
        minimumPayment: 100,
        nextPaymentDue: date,
        paymentCalculationMethod: 'principal-only',
        paymentHistory: []
      },
      {
        id: 2,
        name: 'Credit card',
        type: 'Credit Card',
        startingBalance: 500,
        currentBalance: 200,
        minimumPayment: 50,
        nextPaymentDue: date,
        paymentCalculationMethod: 'principal-only',
        paymentHistory: []
      }
    ]
  }))

  const container = await render(Debt)
  const summary = container.querySelector('[aria-label="Overall debt progress"]')
  assert.ok(summary)
  assert.match(summary.textContent, /TOTAL DEBT REMAINING/)
  assert.match(summary.textContent, /\$600\.00/)
  assert.match(summary.textContent, /TOTAL PAID OFF/)
  assert.match(summary.textContent, /\$900\.00/)
  assert.match(summary.textContent, /60% paid off/)

  const progressbar = summary.querySelector('[role="progressbar"]')
  assert.ok(progressbar)
  assert.equal(progressbar.getAttribute('aria-valuenow'), '60')

  // Individual cards directly underneath
  assert.ok(container.querySelector('[aria-label="Debt row: Auto loan"]'))
  assert.ok(container.querySelector('[aria-label="Debt row: Credit card"]'))
})
