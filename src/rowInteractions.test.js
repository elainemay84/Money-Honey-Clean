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
const [{ default: Bills }, { default: Accounts }] = await Promise.all([
  vite.ssrLoadModule('/src/Bills.jsx'),
  vite.ssrLoadModule('/src/Accounts.jsx')
])
const roots = new Set()
const rootContainers = new Map()

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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
    const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')?.set
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
  assert.match(container.querySelector('[role="dialog"] h2').textContent, /Edit bill occurrence/)
  await click(button(container.querySelector('[role="dialog"]'), 'Cancel'))

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
  assert.match(container.querySelector('[role="dialog"] h2').textContent, /Edit income occurrence/)
  await click(button(container.querySelector('[role="dialog"]'), 'Cancel'))

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
