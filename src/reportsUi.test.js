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

test('refunds, transfers, debt payments, income, and linked bill duplicates do not inflate the report', async () => {
  const link = `bill:3:${day(currentMonth, 5)}`
  seed([
    txn('Shopping', -100, day(currentMonth, 2)),
    txn('Shopping', 40, day(currentMonth, 3)),
    txn('Other', -500, day(currentMonth, 4), { type: 'transfer' }),
    txn('Other', -500, day(currentMonth, 4), { name: 'Transfer to Savings' }),
    txn('Debt Payments', -214, day(currentMonth, 4), { linkedDebtId: 1, linkedDebtPaymentId: 'p1' }),
    txn('Paycheck', 2000, day(currentMonth, 1)),
    txn('Subscriptions', -15.99, day(currentMonth, 5), { linkedOccurrenceId: link, linkedOccurrenceType: 'bill', cleared: false }),
    txn('Subscriptions', -15.99, day(currentMonth, 5), { linkedOccurrenceId: link, linkedOccurrenceType: 'bill', cleared: true })
  ])
  const container = await renderApp()
  await openReports(container)

  assert.deepEqual(rows(container).map(row => row.name), ['Shopping', 'Subscriptions'])
  assert.match(rows(container)[0].text, /\$100\.00/)
  assert.match(rows(container)[1].text, /\$15\.99/)
  assert.match(container.querySelector('[role="img"]').parentElement.textContent, /\$115\.99/)
  assert.match(container.textContent, /\$40\.00 in refunds this month are not subtracted, matching Budgets/)
})

test('the totals match the Budgets page spending for the same month', async () => {
  seed([txn('Groceries', -80, day(currentMonth, 2)), txn('Shopping', -20, day(currentMonth, 3)), txn('Groceries', -15, day(month(-1), 9))])
  const container = await renderApp()

  await click([...container.querySelectorAll('nav > div')].find(item => item.textContent.includes('Budgets')))
  assert.match(container.textContent, /Spending this month\s*\$100\.00/)

  await openReports(container)
  assert.match(container.querySelector('[role="img"]').parentElement.textContent, /\$100\.00/)
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
