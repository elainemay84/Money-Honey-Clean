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
const { default: App } = await vite.ssrLoadModule('/src/App.jsx')
const { THEME_PRESETS, THEME_STORAGE_KEY } = await vite.ssrLoadModule('/src/themeData.js')
const { contrastRatio, formatMonthLabel, shiftMonth } = await vite.ssrLoadModule('/src/reportData.js')
const toHex = color => color.startsWith('#') ? color : `#${color.match(/\d+/g).slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`
const roots = []

const pad = value => String(value).padStart(2, '0')
const now = new Date()
const currentMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const month = delta => shiftMonth(currentMonth, delta)
const day = (monthKey, dayOfMonth) => `${monthKey}-${pad(dayOfMonth)}`

let nextId = 1
const txn = (category, amount, date, extra = {}) =>
  ({ id: nextId++, sequence: nextId, accountId: 1, name: `${category} item`, amount, date, cleared: true, category, ...extra })

function seed(transactions, theme = null) {
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    version: 1,
    accounts: [{ id: 1, name: 'Checking', type: 'Checking', openingBalance: 1000, openingDate: '2020-01-01', color: '#B87522', defaultCleared: false, archived: false }],
    transactions
  }))
  browser.localStorage.setItem('money-honey-bills', '{"version":1,"bills":[],"incomes":[]}')
  if (theme) browser.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ presetVersion: 2, themeId: theme }))
}

async function renderApp() {
  const container = browser.document.createElement('div')
  browser.document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(React.createElement(App)))
  return container
}

const buttonWithText = (container, text) => [...container.querySelectorAll('button')].find(item => item.textContent.trim().startsWith(text))
const navItems = container => [...container.querySelectorAll('nav > div')].map(item => item.textContent.replace(/[^A-Za-z]/g, ''))

async function click(element) {
  assert.ok(element, 'Expected an element to click')
  await act(async () => {
    element.dispatchEvent(new browser.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function openReports(container) {
  await click([...container.querySelectorAll('nav > div')].find(item => item.textContent.includes('More')))
  await click(buttonWithText(container, 'Reports'))
}

const rows = container => [...container.querySelectorAll('[data-report-row]')].map(row => ({
  name: row.getAttribute('data-report-row'),
  text: row.textContent
}))
const monthLabel = container => container.querySelector('[aria-label="Report month"] strong').textContent

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

test('Reports is an option on More, the six bottom tabs are unchanged, and Back returns to More', async () => {
  seed([])
  const container = await renderApp()
  assert.deepEqual(navItems(container), ['Home', 'Accounts', 'Bills', 'Budgets', 'Debt', 'More'])

  await click([...container.querySelectorAll('nav > div')].find(item => item.textContent.includes('More')))
  assert.ok(buttonWithText(container, 'Settings'))
  assert.ok(buttonWithText(container, 'Ask Honey'))
  await click(buttonWithText(container, 'Reports'))

  assert.equal(container.querySelector('h1').textContent, 'Reports')
  assert.match(container.textContent, /Spending by Category/)
  assert.deepEqual(navItems(container), ['Home', 'Accounts', 'Bills', 'Budgets', 'Debt', 'More'])

  await click(buttonWithText(container, '‹ More'))
  assert.equal(container.querySelector('h1').textContent, 'More')
  assert.ok(buttonWithText(container, 'Reports'))
})

test('the report defaults to the current month and lists categories highest first with amounts and percentages', async () => {
  seed([
    txn('Groceries', -120.5, day(currentMonth, 2)),
    txn('Groceries', -79.5, day(currentMonth, 3)),
    txn('Gas & Fuel', -300, day(currentMonth, 4)),
    txn('Eating Out', -50, day(currentMonth, 5)),
    txn('Shopping', -50, day(currentMonth, 6)),
    txn('Paycheck', 1500, day(currentMonth, 1))
  ])
  const container = await renderApp()
  await openReports(container)

  assert.equal(monthLabel(container), formatMonthLabel(currentMonth))
  assert.deepEqual(rows(container).map(row => row.name), ['Gas & Fuel', 'Groceries', 'Eating Out', 'Shopping'])
  assert.match(rows(container)[0].text, /\$300\.00\s*50%/)
  assert.match(rows(container)[1].text, /\$200\.00\s*34%/)
  assert.match(container.querySelector('[role="img"]').parentElement.textContent, /Total spent\$600\.00/)
  assert.equal(container.querySelectorAll('circle[data-report-slice]').length, 4)
  assert.match(container.querySelector('[role="img"]').getAttribute('aria-label'), /\$600\.00 total across 4 categories/)
})

test('switching months updates both the chart and the list, and the arrows stop at the data range', async () => {
  seed([
    txn('Groceries', -40, day(month(-2), 10)),
    txn('Shopping', -25, day(month(-2), 11)),
    txn('Pets', -70, day(month(0), 3))
  ])
  const container = await renderApp()
  await openReports(container)

  const previous = () => container.querySelector('[aria-label="Previous month"]')
  const next = () => container.querySelector('[aria-label="Next month"]')
  assert.equal(next().disabled, true)
  assert.deepEqual(rows(container).map(row => row.name), ['Pets'])

  await click(previous())
  assert.equal(monthLabel(container), formatMonthLabel(month(-1)))
  assert.equal(container.querySelector('[data-report-slice]'), null)
  assert.match(container.textContent, new RegExp(`No spending recorded for ${formatMonthLabel(month(-1))}`))

  await click(previous())
  assert.equal(monthLabel(container), formatMonthLabel(month(-2)))
  assert.deepEqual(rows(container).map(row => row.name), ['Groceries', 'Shopping'])
  assert.match(container.querySelector('[role="img"]').parentElement.textContent, /\$65\.00/)
  assert.equal(previous().disabled, true)

  await click(next())
  await click(next())
  assert.equal(monthLabel(container), formatMonthLabel(month(0)))
  assert.deepEqual(rows(container).map(row => row.name), ['Pets'])
})

test('an empty month shows a simple empty state with no chart', async () => {
  seed([txn('Paycheck', 1500, day(currentMonth, 1)), txn('Groceries', -30, day(month(-1), 5))])
  const container = await renderApp()
  await openReports(container)

  assert.match(container.textContent, new RegExp(`No spending recorded for ${formatMonthLabel(currentMonth)}\\.`))
  assert.equal(container.querySelector('svg[role="img"]'), null)
  assert.equal(container.querySelectorAll('[data-report-row]').length, 0)
})

test('refunds reduce their category; transfers, linked debt payments, income, and duplicate links never count as spending', async () => {
  const link = `bill:3:${day(currentMonth, 5)}`
  seed([
    txn('Shopping', -100, day(currentMonth, 2)),
    txn('Shopping', 40, day(currentMonth, 3)),
    txn('Other', -500, day(currentMonth, 4), { type: 'transfer' }),
    txn('Other', -500, day(currentMonth, 4), { name: 'Transfer to Savings' }),
    txn('Debt Payments', -214, day(currentMonth, 4), { linkedDebtId: 1, linkedDebtPaymentId: 'p1' }),
    txn('Gas & Fuel', -90, day(currentMonth, 4), { linkedDebtId: 2, transactionType: 'debt-payment' }),
    txn('Paycheck', 2000, day(currentMonth, 1)),
    txn('Subscriptions', -15.99, day(currentMonth, 5), { linkedOccurrenceId: link, linkedOccurrenceType: 'bill', cleared: false }),
    txn('Subscriptions', -15.99, day(currentMonth, 5), { linkedOccurrenceId: link, linkedOccurrenceType: 'bill', cleared: true })
  ])
  const container = await renderApp()
  await openReports(container)

  assert.deepEqual(rows(container).map(row => row.name), ['Shopping', 'Subscriptions'])
  assert.match(rows(container)[0].text, /\$60\.00/)
  assert.match(rows(container)[1].text, /\$15\.99/)
  assert.match(container.querySelector('[role="img"]').parentElement.textContent, /\$75\.99/)
  assert.match(spendingCard(container).textContent, /Net of \$40\.00 in refunds\./)
})

test('uncategorized spending appears as its own Uncategorized category in the chart and list', async () => {
  seed([
    txn('Groceries', -50, day(currentMonth, 2)),
    txn(undefined, -30, day(currentMonth, 3)),
    txn('Deleted Category', -20, day(currentMonth, 4))
  ])
  const container = await renderApp()
  await openReports(container)

  assert.deepEqual(rows(container).map(row => row.name), ['Groceries', 'Uncategorized'])
  assert.match(rows(container)[1].text, /\$50\.00/)
  assert.match(container.querySelector('[role="img"]').parentElement.textContent, /\$100\.00/)
  assert.ok(container.querySelector('circle[data-report-slice="Uncategorized"]'))
})

test('the totals match the Budgets page spending for the same month, including uncategorized spending and refunds', async () => {
  seed([
    txn('Groceries', -80, day(currentMonth, 2)),
    txn('Shopping', -20, day(currentMonth, 3)),
    txn(undefined, -15, day(currentMonth, 4)),
    txn('Shopping', 5, day(currentMonth, 5)),
    txn('Debt Payments', -300, day(currentMonth, 6)),
    txn('Groceries', -15, day(month(-1), 9))
  ])
  const container = await renderApp()

  await click([...container.querySelectorAll('nav > div')].find(item => item.textContent.includes('Budgets')))
  assert.match(container.textContent, /Spending this month\s*\$110\.00/)

  await openReports(container)
  assert.match(container.querySelector('[role="img"]').parentElement.textContent, /\$110\.00/)
  assert.equal(barAmount(container, 'Expenses'), '$110.00')
})

test('viewing reports never changes stored data', async () => {
  seed([txn('Groceries', -80, day(currentMonth, 2)), txn('Shopping', 20, day(currentMonth, 3))])
  const snapshot = () => JSON.stringify(Array.from({ length: browser.localStorage.length }, (_, index) => browser.localStorage.key(index))
    .sort().map(key => [key, browser.localStorage.getItem(key)]))
  const container = await renderApp()
  const before = snapshot()
  await openReports(container)
  await click(container.querySelector('[aria-label="Previous month"]'))
  await click(container.querySelector('[aria-label="Next month"]'))
  assert.equal(snapshot(), before)
})

test('chart colors are readable on every preset theme, light and dark', async () => {
  const cardLuminance = new Set()
  for (const theme of THEME_PRESETS) {
    seed([
      txn('Groceries', -120, day(currentMonth, 2)),
      txn('Gas & Fuel', -90, day(currentMonth, 3)),
      txn('Shopping', -60, day(currentMonth, 4)),
      txn('Pets', -30, day(currentMonth, 5))
    ], theme.id)
    const container = await renderApp()
    await openReports(container)

    const shell = container.querySelector('.app-shell')
    assert.ok(shell.classList.contains(`theme-${theme.id}`), theme.id)
    const card = shell.style.getPropertyValue('--theme-card')
    assert.equal(card, theme.colors.card)
    const swatches = [...container.querySelectorAll('[data-report-swatch]')].map(item => item.style.background)
    const strokes = [...container.querySelectorAll('circle[data-report-slice]')].map(item => item.getAttribute('stroke'))
    assert.equal(swatches.length, 4)
    const toHex = color => color.startsWith('#') ? color : `#${color.match(/\d+/g).slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('')}`
    for (const color of [...swatches, ...strokes]) {
      assert.match(toHex(color), /^#[0-9a-f]{6}$/, `${theme.id}: unreadable color ${color}`)
      assert.ok(contrastRatio(toHex(color), card) >= 3, `${theme.id}: ${color} on ${card}`)
    }
    assert.deepEqual(swatches.map(toHex), strokes.map(toHex))
    cardLuminance.add(contrastRatio(card, '#000000') > contrastRatio(card, '#FFFFFF') ? 'light' : 'dark')
    await act(async () => roots.pop().unmount())
    container.remove()
    browser.localStorage.clear()
  }
  assert.deepEqual([...cardLuminance].sort(), ['dark', 'light'])
})

test('the report renders at every Appearance Size', async () => {
  for (const size of ['small', 'medium', 'large']) {
    seed([txn('Groceries', -80, day(currentMonth, 2))])
    browser.localStorage.setItem('money-honey-appearance-size', size)
    const container = await renderApp()
    await openReports(container)

    assert.ok(container.querySelector('.app-shell').classList.contains(`appearance-${size}`))
    assert.deepEqual(rows(container).map(row => row.name), ['Groceries'])
    await act(async () => roots.pop().unmount())
    container.remove()
  }
})

// ---- Income vs. Expenses ----
const flowCard = container => container.querySelector('section[aria-labelledby="income-vs-expenses-title"]')
const spendingCard = container => container.querySelector('section[aria-labelledby="spending-by-category-title"]')
const barAmount = (container, label) => flowCard(container).querySelector(`[data-report-bar="${label}"] strong`).textContent
const netText = container => flowCard(container).querySelector('[data-report-net]').textContent

test('Income vs. Expenses is the second card, below Spending by Category, with totals and net cash flow', async () => {
  seed([
    txn('Paycheck', 2000, day(currentMonth, 1)),
    txn('Other Income', 250.5, day(currentMonth, 9)),
    txn('Groceries', -120.25, day(currentMonth, 2)),
    txn('Housing & Utilities', -900, day(currentMonth, 3))
  ])
  const container = await renderApp()
  await openReports(container)

  const headings = [...container.querySelectorAll('main h2')].map(item => item.textContent)
  assert.deepEqual(headings, ['Spending by Category', 'Income vs. Expenses'])
  assert.equal(barAmount(container, 'Income'), '$2,250.50')
  assert.equal(barAmount(container, 'Expenses'), '$1,020.25')
  assert.match(netText(container), /Net cash flow\+\$1,230\.25/)
  assert.match(flowCard(container).textContent, /Income exceeded expenses by \$1,230\.25\./)
  assert.match(flowCard(container).textContent, /Recorded transactions only\. Transfers are excluded\./)
  assert.equal(flowCard(container).querySelector('[data-report-bar-fill="Income"]').style.width, '100.00%')
  assert.match(flowCard(container).querySelector('[data-report-bar-fill="Expenses"]').style.width, /^45\.3\d%$/)
})

test('negative net cash flow is shown clearly when expenses exceed income', async () => {
  seed([txn('Paycheck', 500, day(currentMonth, 1)), txn('Housing & Utilities', -900, day(currentMonth, 2))])
  const container = await renderApp()
  await openReports(container)

  assert.match(netText(container), /Net cash flow-\$400\.00/)
  assert.match(flowCard(container).textContent, /Expenses exceeded income by \$400\.00\./)
  assert.equal(flowCard(container).querySelector('[data-report-bar-fill="Expenses"]').style.width, '100.00%')
})

test('transfers, duplicate links, schedules, and debt payments are handled without double counting', async () => {
  const bill = `bill:3:${day(currentMonth, 5)}`
  const pay = `income:1:${day(currentMonth, 1)}`
  seed([
    txn('Paycheck', 1500, day(currentMonth, 1), { linkedOccurrenceId: pay, cleared: false }),
    txn('Paycheck', 1500, day(currentMonth, 1), { linkedOccurrenceId: pay, cleared: true }),
    txn('Subscriptions', -15.99, day(currentMonth, 5), { linkedOccurrenceId: bill, cleared: false }),
    txn('Subscriptions', -15.99, day(currentMonth, 5), { linkedOccurrenceId: bill, cleared: true }),
    txn('Other', -500, day(currentMonth, 6), { type: 'transfer' }),
    txn('Other Income', 500, day(currentMonth, 6), { name: 'Transfer from Savings' }),
    txn('Debt Payments', -214, day(currentMonth, 7), { name: 'Debt payment · Card', linkedDebtId: 1, linkedDebtPaymentId: 'p1', transactionType: 'debt-payment' }),
    txn(undefined, -10, day(currentMonth, 8))
  ])
  browser.localStorage.setItem('money-honey-bills', JSON.stringify({
    version: 1,
    bills: [{ id: 3, name: 'Streaming', amount: 999, dueDate: day(currentMonth, 28), frequency: 'monthly', autopay: false, accountId: 1, paymentHistory: [] }],
    incomes: [{ id: 1, name: 'Pay', amount: 9999, frequency: 'monthly', accountId: 1, paymentHistory: [] }]
  }))
  const container = await renderApp()
  await openReports(container)

  assert.equal(barAmount(container, 'Income'), '$1,500.00')
  assert.equal(barAmount(container, 'Expenses'), '$25.99')
  assert.match(netText(container), /\+\$1,474\.01/)
  assert.match(flowCard(container).textContent, /Debt payments \(\$214\.00\) are not counted as expenses\./)
})

test('refunds reduce expenses on both cards and are never counted as income', async () => {
  seed([txn('Shopping', -100, day(currentMonth, 2)), txn('Shopping', 40, day(currentMonth, 3)), txn('Paycheck', 1000, day(currentMonth, 1))])
  const container = await renderApp()
  await openReports(container)

  assert.equal(barAmount(container, 'Income'), '$1,000.00')
  assert.equal(barAmount(container, 'Expenses'), '$60.00')
  assert.match(netText(container), /\+\$940\.00/)
  assert.match(flowCard(container).textContent, /Expenses are net of \$40\.00 in refunds\./)
  assert.match(spendingCard(container).textContent, /Net of \$40\.00 in refunds\./)
  assert.match(spendingCard(container).querySelector('[role="img"]').parentElement.textContent, /Total spent\$60\.00/)
})

test('credits on a credit card account are not counted as income', async () => {
  seed([txn('Paycheck', 1000, day(currentMonth, 1)), txn('Paycheck', 400, day(currentMonth, 2), { accountId: 2, name: 'Payment received' }), txn('Shopping', -50, day(currentMonth, 3), { accountId: 2 })])
  const stored = JSON.parse(browser.localStorage.getItem('money-honey-account-data'))
  stored.accounts.push({ id: 2, name: 'Visa', type: 'Credit Card', openingBalance: 0, openingDate: '2020-01-01', color: '#000000', defaultCleared: false, archived: false })
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify(stored))
  const container = await renderApp()
  await openReports(container)

  assert.equal(barAmount(container, 'Income'), '$1,000.00')
  assert.equal(barAmount(container, 'Expenses'), '$50.00')
  assert.match(container.textContent, /credit card account/)
})

test('switching months updates Spending by Category and Income vs. Expenses together', async () => {
  seed([
    txn('Paycheck', 1000, day(month(-2), 1)), txn('Groceries', -250, day(month(-2), 5)),
    txn('Paycheck', 3000, day(month(0), 1)), txn('Pets', -70, day(month(0), 3))
  ])
  const container = await renderApp()
  await openReports(container)

  assert.equal(barAmount(container, 'Income'), '$3,000.00')
  assert.equal(barAmount(container, 'Expenses'), '$70.00')
  assert.deepEqual(rows(container).map(row => row.name), ['Pets'])

  await click(container.querySelector('[aria-label="Previous month"]'))
  assert.equal(monthLabel(container), formatMonthLabel(month(-1)))
  assert.match(flowCard(container).textContent, new RegExp(`No income or expenses recorded for ${formatMonthLabel(month(-1))}\\.`))
  assert.equal(flowCard(container).querySelector('[data-report-bar]'), null)
  assert.match(spendingCard(container).textContent, /No spending recorded for/)

  await click(container.querySelector('[aria-label="Previous month"]'))
  assert.equal(barAmount(container, 'Income'), '$1,000.00')
  assert.equal(barAmount(container, 'Expenses'), '$250.00')
  assert.match(netText(container), /\+\$750\.00/)
  assert.deepEqual(rows(container).map(row => row.name), ['Groceries'])

  await click(container.querySelector('[aria-label="Next month"]'))
  await click(container.querySelector('[aria-label="Next month"]'))
  assert.equal(barAmount(container, 'Income'), '$3,000.00')
  assert.deepEqual(rows(container).map(row => row.name), ['Pets'])
})

test('a month with income but no expenses still shows income, and Spending by Category shows its empty state', async () => {
  seed([txn('Paycheck', 1200, day(currentMonth, 1))])
  const container = await renderApp()
  await openReports(container)

  assert.equal(barAmount(container, 'Income'), '$1,200.00')
  assert.equal(barAmount(container, 'Expenses'), '$0.00')
  assert.equal(flowCard(container).querySelector('[data-report-bar-fill="Expenses"]').style.width, '0.00%')
  assert.match(spendingCard(container).textContent, /No spending recorded/)
})

test('Income vs. Expenses bar colors are readable on every preset theme, light and dark', async () => {
  for (const theme of THEME_PRESETS) {
    seed([txn('Paycheck', 2000, day(currentMonth, 1)), txn('Groceries', -600, day(currentMonth, 2))], theme.id)
    const container = await renderApp()
    await openReports(container)

    const card = container.querySelector('.app-shell').style.getPropertyValue('--theme-card')
    assert.equal(card, theme.colors.card)
    const income = toHex(flowCard(container).querySelector('[data-report-bar-fill="Income"]').style.background)
    const expenses = toHex(flowCard(container).querySelector('[data-report-bar-fill="Expenses"]').style.background)
    assert.match(income, /^#[0-9a-f]{6}$/, theme.id)
    assert.match(expenses, /^#[0-9a-f]{6}$/, theme.id)
    assert.notEqual(income, expenses)
    assert.ok(contrastRatio(income, card) >= 3, `${theme.id} income ${income} on ${card}`)
    assert.ok(contrastRatio(expenses, card) >= 3, `${theme.id} expenses ${expenses} on ${card}`)
    await act(async () => roots.pop().unmount())
    container.remove()
    browser.localStorage.clear()
  }
})

test('the report fits at every Appearance Size and never changes stored data', async () => {
  for (const size of ['small', 'medium', 'large']) {
    seed([txn('Paycheck', 900, day(currentMonth, 1)), txn('Groceries', -90, day(currentMonth, 2))])
    browser.localStorage.setItem('money-honey-appearance-size', size)
    const snapshot = () => JSON.stringify(Array.from({ length: browser.localStorage.length }, (_, index) => browser.localStorage.key(index)).sort()
      .map(key => [key, browser.localStorage.getItem(key)]))
    const container = await renderApp()
    const before = snapshot()
    await openReports(container)
    await click(container.querySelector('[aria-label="Previous month"]'))
    assert.equal(snapshot(), before)
    assert.ok(container.querySelector('.app-shell').classList.contains(`appearance-${size}`))
    assert.ok(flowCard(container))
    await act(async () => roots.pop().unmount())
    container.remove()
  }
})

const reviewCard = container => container.querySelector('section[aria-labelledby="needs-classification-title"]')

test('records that need classification are listed collapsed, unchanged, and follow the selected month', async () => {
  seed([
    txn(undefined, -12, day(currentMonth, 3), { name: 'Mystery charge' }),
    txn('Other', -300, day(currentMonth, 5), { name: 'Chase Visa payment' }),
    txn('Other Income', 35, day(currentMonth, 6), { name: 'Refund from store' }),
    txn('Shopping', 90, day(currentMonth, 7), { name: 'Return' }),
    txn('Groceries', -40, day(month(-1), 2))
  ])
  const before = browser.localStorage.getItem('money-honey-account-data')
  const container = await renderApp()
  await openReports(container)

  const card = reviewCard(container)
  assert.ok(card)
  assert.equal(card.querySelector('details').open, false)
  assert.match(card.textContent, /4 transactions may need a category or type/)
  assert.match(card.textContent, /Counted under Uncategorized/)
  assert.match(card.textContent, /Looks like a credit card payment but is not linked to a debt/)
  assert.match(card.textContent, /name suggests a refund or reimbursement/)
  assert.match(card.textContent, /no matching spending in this category this month/)
  assert.match(card.textContent, /Nothing was changed\./)
  assert.equal(card.querySelectorAll('[data-review-item]').length, 4)

  await click(container.querySelector('[aria-label="Previous month"]'))
  assert.equal(reviewCard(container), null)
  assert.equal(browser.localStorage.getItem('money-honey-account-data'), before)
})

test('no review card appears when every transaction is clearly classified', async () => {
  seed([txn('Groceries', -40, day(currentMonth, 2)), txn('Paycheck', 1000, day(currentMonth, 1))])
  const container = await renderApp()
  await openReports(container)
  assert.equal(reviewCard(container), null)
})

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

test('clicking a flagged transaction opens the editor for that exact transaction with a pencil icon', async () => {
  seed([
    txn(undefined, -35, day(currentMonth, 5), { id: 101, accountId: 1, name: 'Target run' })
  ])
  const container = await renderApp()
  await openReports(container)

  const card = reviewCard(container)
  const itemBtn = card.querySelector('[data-review-item="101"] button')
  assert.ok(itemBtn)
  assert.match(itemBtn.textContent, /✎/)

  await click(itemBtn)

  const dialog = container.querySelector('[role="dialog"]')
  assert.ok(dialog)
  assert.equal(dialog.querySelector('#add-transaction-title').textContent, 'Edit Transaction')
  assert.equal(dialog.querySelector('input[aria-label="Payee or description"]').value, 'Target run')
  assert.equal(dialog.querySelector('input[aria-label="Amount"]').value, '35')
  assert.equal(dialog.querySelector('input[aria-label="Transaction date"]').value, day(currentMonth, 5))
  assert.equal(dialog.querySelector('select[aria-label="Transaction category"]').value, '')
})

test('saving a category change updates transaction and returns to Reports with refreshed totals and warnings', async () => {
  seed([
    txn(undefined, -45, day(currentMonth, 5), { id: 102, accountId: 1, name: 'Market' })
  ])
  const container = await renderApp()
  await openReports(container)

  assert.equal(barAmount(container, 'Expenses'), '$45.00')
  assert.deepEqual(rows(container).map(row => row.name), ['Uncategorized'])

  const card = reviewCard(container)
  await click(card.querySelector('[data-review-item="102"] button'))

  const dialog = container.querySelector('[role="dialog"]')
  await changeValue(dialog.querySelector('select[aria-label="Transaction category"]'), 'Groceries')
  await submit(dialog.querySelector('form'))

  assert.equal(container.querySelector('h1').textContent, 'Reports')
  assert.equal(reviewCard(container), null)
  assert.deepEqual(rows(container).map(row => row.name), ['Groceries'])
  assert.equal(barAmount(container, 'Expenses'), '$45.00')

  const stored = JSON.parse(browser.localStorage.getItem('money-honey-account-data'))
  const updatedTxn = stored.transactions.find(t => t.id === 102)
  assert.equal(updatedTxn.category, 'Groceries')
})

test('canceling the edit returns to Reports without changing data', async () => {
  seed([
    txn(undefined, -25, day(currentMonth, 4), { id: 103, accountId: 1, name: 'Bakery' })
  ])
  const before = browser.localStorage.getItem('money-honey-account-data')
  const container = await renderApp()
  await openReports(container)

  const card = reviewCard(container)
  await click(card.querySelector('[data-review-item="103"] button'))

  const dialog = container.querySelector('[role="dialog"]')
  await changeValue(dialog.querySelector('select[aria-label="Transaction category"]'), 'Groceries')
  await click(buttonWithText(dialog, 'Cancel'))

  assert.equal(container.querySelector('h1').textContent, 'Reports')
  assert.ok(reviewCard(container))
  assert.equal(browser.localStorage.getItem('money-honey-account-data'), before)
})

test('transactions with the same description and amount open the correct transaction by ID and account', async () => {
  const storedAccounts = [
    { id: 1, name: 'Checking', type: 'Checking', openingBalance: 1000, openingDate: '2020-01-01', color: '#B87522', defaultCleared: false, archived: false },
    { id: 2, name: 'Savings', type: 'Savings', openingBalance: 500, openingDate: '2020-01-01', color: '#6E9A72', defaultCleared: false, archived: false }
  ]
  const storedTransactions = [
    txn(undefined, -50, day(currentMonth, 1), { id: 201, accountId: 1, name: 'Hardware' }),
    txn(undefined, -50, day(currentMonth, 2), { id: 202, accountId: 2, name: 'Hardware' })
  ]
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({ version: 1, accounts: storedAccounts, transactions: storedTransactions }))
  browser.localStorage.setItem('money-honey-bills', '{"version":1,"bills":[],"incomes":[]}')

  const container = await renderApp()
  await openReports(container)

  const card = reviewCard(container)
  await click(card.querySelector('[data-review-item="202"] button'))

  const dialog = container.querySelector('[role="dialog"]')
  assert.equal(container.querySelector('h1').textContent, 'Savings')
  assert.equal(dialog.querySelector('input[aria-label="Transaction date"]').value, day(currentMonth, 2))
  await click(buttonWithText(dialog, 'Cancel'))
})

test('refunds can be associated with an expense category, reducing category spending and clearing warnings', async () => {
  seed([
    txn('Shopping', -100, day(currentMonth, 1), { id: 301, accountId: 1, name: 'Clothing store' }),
    txn('Other Income', 40, day(currentMonth, 3), { id: 302, accountId: 1, name: 'Refund from clothing store' })
  ])
  const container = await renderApp()
  await openReports(container)

  assert.equal(barAmount(container, 'Income'), '$40.00')
  assert.equal(barAmount(container, 'Expenses'), '$100.00')
  const card = reviewCard(container)
  assert.ok(card)
  await click(card.querySelector('[data-review-item="302"] button'))

  const dialog = container.querySelector('[role="dialog"]')
  await changeValue(dialog.querySelector('select[aria-label="Transaction category"]'), 'Shopping')
  await submit(dialog.querySelector('form'))

  assert.equal(container.querySelector('h1').textContent, 'Reports')
  assert.equal(reviewCard(container), null)
  assert.equal(barAmount(container, 'Income'), '$0.00')
  assert.equal(barAmount(container, 'Expenses'), '$60.00')
  assert.match(spendingCard(container).textContent, /Net of \$40\.00 in refunds\./)
})

test('suspected card payments can be classified as Debt Payments, updating net cash flow and clearing warnings', async () => {
  seed([
    txn('Other', -200, day(currentMonth, 6), { id: 401, accountId: 1, name: 'Chase Visa payment' })
  ])
  const container = await renderApp()
  await openReports(container)

  assert.equal(barAmount(container, 'Expenses'), '$200.00')
  const card = reviewCard(container)
  assert.ok(card)
  await click(card.querySelector('[data-review-item="401"] button'))

  const dialog = container.querySelector('[role="dialog"]')
  await changeValue(dialog.querySelector('select[aria-label="Transaction category"]'), 'Debt Payments')
  await submit(dialog.querySelector('form'))

  assert.equal(container.querySelector('h1').textContent, 'Reports')
  assert.equal(reviewCard(container), null)
  assert.equal(barAmount(container, 'Expenses'), '$0.00')
  assert.match(flowCard(container).textContent, /Debt payments \(\$200\.00\) are not counted as expenses\./)
})

