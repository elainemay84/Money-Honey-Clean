import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

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
const [{ default: Bills }, { default: Accounts }, { default: Debt }, { default: App }] = await Promise.all([
  vite.ssrLoadModule('/src/Bills.jsx'),
  vite.ssrLoadModule('/src/Accounts.jsx'),
  vite.ssrLoadModule('/src/Debt.jsx'),
  vite.ssrLoadModule('/src/App.jsx')
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

function readAccountData() {
  return JSON.parse(browser.localStorage.getItem('money-honey-account-data'))
}

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

test('bottom navigation opens Budgets and keeps Ask Honey under More', async () => {
  const container = await render(App)
  const nav = container.querySelector('nav')
  assert.equal(nav.children[3].textContent.includes('Budgets'), true)
  await click(nav.children[3])
  assert.match(container.textContent, /Budgets/)

  await click(nav.lastElementChild)
  await click([...container.querySelectorAll('button')].find(item => item.textContent.includes('Ask Honey')))
  assert.match(container.textContent, /Ask Honey/)
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

test('List groups a bounded year of recurring occurrences by month, and Calendar retains its controls', async () => {
  seedData({ recurring: true, recurringIncome: true })
  const container = await render(Bills)
  const billRows = container.querySelectorAll('[aria-label="Bill row: Repeating"]')
  const billMonthGroups = [...container.querySelectorAll('section[aria-label$="bills"]')]
  assert.equal(billRows.length, 12)
  assert.equal(billMonthGroups.length, 12)
  assert.equal(container.querySelector('[aria-label="Previous month"]'), null)
  assert.equal(container.querySelector('[aria-label="Next month"]'), null)
  assert.equal(container.querySelector('[aria-label="Monthly total due"]'), null)
  assert.match(billMonthGroups[0].textContent, /\$80\.00/)
  assert.match(billMonthGroups.at(-1).textContent, /\$80\.00/)

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
  assert.ok(container.querySelector('[aria-label="October 2026 bills"]'))
  assert.ok(container.querySelector('[aria-label="Bill row: Historical Electric"]'))
  assert.match(container.querySelector('[aria-label="Bill row: Historical Electric"]').textContent, /Oct 20, 2026/)
  assert.match(container.querySelector('[aria-label="October 2026 bills"]').textContent, /\$72\.00/)

  await click(button(container, 'Money In'))
  assert.ok(container.querySelector('[aria-label="October 2026 income"]'))
  assert.ok(container.querySelector('[aria-label="Income row: Historical Paycheck"]'))
  assert.match(container.querySelector('[aria-label="October 2026 income"]').textContent, /\$900\.00/)
})

test('List hides completed past months but keeps partial and current months; Show Completed restores history', async () => {
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

  assert.equal(container.querySelector(`[aria-label="${oldBillMonth} bills"]`), null)
  assert.ok(container.querySelector(`[aria-label="${partialBillMonth} bills"] [aria-label="Bill row: Partial unpaid bill"]`))
  assert.equal(container.querySelector(`[aria-label="${partialBillMonth} bills"] [aria-label="Bill row: Partial paid bill"]`), null)
  assert.ok(container.querySelector(`[aria-label="${currentBillMonth} bills"]`))
  assert.equal(container.querySelector(`[aria-label="${currentBillMonth} bills"] [aria-label="Bill row: Current paid bill"]`), null)
  assert.ok(container.querySelector('[aria-label$="bills"] [aria-label="Bill row: Future bill"]'))

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

  assert.ok(container.querySelector('[aria-label="October 2026 bills"] [aria-label="Bill row: Past-dated bill"]'))

  await click(container.querySelector('[aria-label="Bill row: Past-dated bill"]'))
  const editForm = container.querySelector('[role="dialog"] form')
  await changeValue(editForm.querySelector('[aria-label="Due date"]'), '2026-09-20')
  await submit(editForm)
  assert.ok(container.querySelector('[aria-label="September 2026 bills"] [aria-label="Bill row: Past-dated bill"]'))
})

test('paying one recurring bill hides only that occurrence; completed bills remain visible in Calendar', async () => {
  seedData({ recurring: true })
  const container = await render(Bills)
  assert.equal(container.querySelectorAll('[aria-label="Bill row: Repeating"]').length, 12)
  await click(button(container, 'Pay Repeating'))
  await click(button(container.querySelector('[role="dialog"]'), 'Confirm'))

  assert.equal(container.querySelectorAll('[aria-label="Bill row: Repeating"]').length, 11)
  assert.ok(container.querySelector('[aria-label="December 2026 bills"] [aria-label="Bill row: Repeating"]'))
  const november = container.querySelector('[aria-label="November 2026 bills"]')
  assert.match(november.textContent, /Total scheduled/)
  assert.match(november.textContent, /\$80\.00/)

  await click(button(container, 'Calendar'))
  assert.ok(button(container, 'Paid Repeating'))
  assert.equal(readAccountData().transactions.length, 1)
  assert.equal(readAccountData().transactions[0].cleared, false)
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

test('Debt card opens read-only details and Edit Debt opens the compact form', async () => {
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
      nextPaymentDue: '2026-11-15',
      paymentHistory: []
    }]
  }))
  const container = await render(Debt)
  const card = container.querySelector('[aria-label="Debt row: Student loan"]')
  assert.match(card.textContent, /Personal Loan/)
  assert.match(card.textContent, /\$700\.00/)
  assert.match(card.textContent, /\$75\.00/)
  assert.match(card.textContent, /Nov 15, 2026/)
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
  assert.equal(form.querySelectorAll('input[type="number"]').length, 4)
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

test('Debt edits create and update one monthly bill; Bills records and reverses the payment', async () => {
  let debtContainer = await render(Debt)
  await click(button(debtContainer, 'Add debt'))
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
  assert.equal(linkedBill.dueDate, laterDueDate)
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
  await click(button(container, 'Add debt'))
  const form = container.querySelector('[aria-label="Add debt form"] form')
  await changeValue(form.querySelector('[aria-label="Debt name"]'), 'Store card debt')
  await changeValue(form.querySelector('[aria-label="Debt type"]'), 'Credit Card')
  await changeValue(form.querySelector('[aria-label="Starting balance · original amount borrowed or owed"]'), '500')
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
  await click(button(container, 'Add debt'))
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
