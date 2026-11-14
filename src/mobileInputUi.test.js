import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, afterEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const browser = new Window({ url: 'http://localhost/', width: 390, height: 844 })
for (const key of ['window', 'document', 'navigator', 'localStorage', 'Event', 'MouseEvent', 'HTMLElement', 'Node']) {
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

const css = browser.document.createElement('style')
css.textContent = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  .replace(/^@import.*$/gm, '')
browser.document.head.append(css)

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
const { default: Accounts } = await vite.ssrLoadModule('/src/Accounts.jsx')
const { default: ResponsiveText } = await vite.ssrLoadModule('/src/ResponsiveText.jsx')
let root

async function click(element) {
  assert.ok(element, 'Expected form navigation control')
  await act(async () => element.dispatchEvent(new browser.MouseEvent('click', { bubbles: true })))
}

const button = label => [...browser.document.querySelectorAll('button')]
  .find(element => element.getAttribute('aria-label') === label || element.textContent.includes(label))
const navigate = label => click([...browser.document.querySelectorAll('nav > div')]
  .find(element => element.textContent.includes(label)))

function checkControls(label) {
  const controls = [...browser.document.querySelectorAll('input, select, textarea')]
    .filter(element => !['checkbox', 'radio', 'color'].includes(element.type))
  assert.ok(controls.length, `${label} must expose editable controls`)
  const zoom = Number(browser.getComputedStyle(browser.document.querySelector('.app-shell')).zoom) || 1
  for (const control of controls) {
    for (const state of ['before', 'focused', 'after']) {
      if (state === 'focused') control.focus()
      if (state === 'after') control.blur()
      const style = browser.getComputedStyle(control)
      const name = control.getAttribute('aria-label') || control.type
      assert.ok(parseFloat(style.fontSize) * zoom >= 16, `${label}: ${name} ${state} must render at least 16px`)
      assert.equal(style.boxSizing, 'border-box', `${label}: ${name} must include padding in its width`)
      assert.equal(parseFloat(style.minWidth), 0, `${label}: ${name} must be able to shrink`)
      assert.equal(style.maxWidth, control.style.maxWidth || '100%', `${label}: ${name} must stay within its container`)
    }
  }
}

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  root = undefined
  browser.document.body.replaceChildren()
  browser.localStorage.clear()
})

after(async () => {
  await vite.close()
  browser.happyDOM.abort()
})

for (const [size, width] of [['small', 320], ['medium', 390], ['large', 932]]) {
  test(`${size} mobile appearance keeps all main form controls above the focus-zoom threshold`, async () => {
    browser.happyDOM.setWindowSize({ width, height: 844 })
    browser.localStorage.setItem('money-honey-appearance-size', size)
    const container = browser.document.createElement('div')
    browser.document.body.append(container)
    root = createRoot(container)
    await act(async () => root.render(React.createElement(App)))

    await navigate('Accounts')
    await click(button('Add account'))
    checkControls('Add account')
    await click(button('Manage accounts'))
    checkControls('Manage accounts')
    await click(button('Done'))
    await click(button('Everyday Checking'))
    checkControls('Inline transaction dates and sorting')
    await click(button('Add transaction'))
    checkControls('Add transaction')

    await navigate('Bills')
    await click(button('Add bill'))
    checkControls('Bills')
    await click(button('Close bill form'))
    await click(button('Money In'))
    await click(button('Add income'))
    assert.ok(browser.document.querySelector('textarea'))
    checkControls('Income and notes')

    await navigate('Debt')
    await click(button('Add debt'))
    checkControls('Debts')

    await navigate('Budgets')
    await click(button('Other Categories'))
    await click(button('Groceries'))
    checkControls('Budget amount')
    await click(button('Cancel'))
    await click(button('Budget settings'))
    checkControls('Budget settings')

    await navigate('More')
    await click(button('Settings'))
    await click(button('Categories & Payees'))
    checkControls('Settings categories and payees')
  })
}

test('account register keeps compact secondary dates over zoom-safe native pickers and fitted totals', async () => {
  browser.happyDOM.setWindowSize({ width: 320, height: 844 })
  browser.localStorage.setItem('money-honey-account-data', JSON.stringify({
    version: 1,
    accounts: [{
      id: 1, name: 'Investments', type: 'Investment', openingBalance: 123456.78,
      openingDate: '2026-11-01', defaultCleared: false, archived: false
    }],
    transactions: [
      { id: 1, sequence: 1, accountId: 1, name: 'A long deposit description', amount: 1000000, date: '2026-11-02', cleared: true },
      { id: 2, sequence: 2, accountId: 1, name: 'Pending expense', amount: -123456.78, date: '2026-11-03', cleared: false }
    ]
  }))
  const container = browser.document.createElement('div')
  container.className = 'theme-typography theme-customized appearance-small app-shell'
  container.style.setProperty('--theme-line-spacing', '1.65')
  browser.document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(React.createElement(Accounts)))
  await click(container.querySelector('[data-account-id="1"]'))
  const before = browser.localStorage.getItem('money-honey-account-data')
  const rows = [...container.querySelectorAll('.account-transaction-row')]
  assert.equal(rows.length, 2)
  for (const row of rows) {
    const name = row.querySelector('.account-transaction-name')
    const date = row.querySelector('.account-transaction-date')
    const time = date.querySelector('time')
    const picker = date.querySelector('input[type="date"]')
    const amount = row.querySelector('.account-transaction-amount')
    const running = row.querySelector('.account-transaction-running')
    const style = element => browser.getComputedStyle(element)
    assert.equal(style(name).fontSize, '14px')
    assert.equal(name.tagName, 'STRONG')
    assert.equal(style(time).fontSize, '11px')
    assert.equal(time.dateTime, picker.value)
    assert.ok(date.querySelector('svg[aria-hidden="true"]'))
    assert.equal(style(picker).position, 'absolute')
    assert.equal(style(picker).opacity, '0')
    assert.ok(parseFloat(style(picker).fontSize) * 0.94 >= 16)
    assert.equal(style(date).minHeight, '24px')
    assert.equal(style(name).lineHeight, '1.2')
    assert.equal(style(running).lineHeight, '1.2')
    assert.equal(style(amount).fontSize, '14px')
    assert.equal(style(running).fontSize, '11px')
    assert.equal(style(amount).textAlign, 'right')
    assert.equal(style(running).textAlign, 'right')
    assert.equal(style(amount).whiteSpace, 'nowrap')
    assert.equal(style(running).whiteSpace, 'nowrap')
    assert.equal(amount.nextElementSibling, running)
    assert.equal(row.style.padding, '2px 0px')
    assert.ok(row.style.borderBottom)
  }
  assert.deepEqual(rows.map(row => row.querySelector('.account-transaction-amount').textContent), ['-$123,456.78', '$1,000,000.00'])
  assert.deepEqual(rows.map(row => row.querySelector('.account-transaction-running').textContent), ['$1,000,000.00', '$1,123,456.78'])
  assert.deepEqual(rows.map(row => row.querySelector('.account-transaction-date time').textContent), ['11/3/2026', '11/2/2026'])
  assert.equal(rows[0].querySelector('button').getAttribute('aria-pressed'), 'false')
  assert.equal(rows[1].querySelector('button').getAttribute('aria-pressed'), 'true')
  assert.deepEqual([...container.querySelector('[aria-label="Transaction sorting order"]').options].map(option => option.value), ['desc', 'asc'])
  assert.ok(container.querySelector('.account-summary-card'))
  assert.equal(container.querySelector('.page-header h1').textContent, 'Investments')
  assert.equal(browser.localStorage.getItem('money-honey-account-data'), before)
  const sort = container.querySelector('[aria-label="Transaction sorting order"]')
  await act(async () => {
    sort.value = 'asc'
    sort.dispatchEvent(new browser.Event('change', { bubbles: true }))
  })
  assert.deepEqual([...container.querySelectorAll('.account-transaction-row')].map(row => row.dataset.transactionId), ['1', '2'])
  assert.deepEqual([...container.querySelectorAll('.account-transaction-running')].map(element => element.textContent), ['$1,123,456.78', '$1,000,000.00'])
  assert.equal(browser.localStorage.getItem('money-honey-account-data'), before)
})

test('mobile sizing covers other editable control types without changing theme styling or desktop sizing', () => {
  browser.document.body.innerHTML = `<label style="font-size: 12px; font-family: Georgia; color: rgb(73, 51, 32)">
    <input type="search" style="font-size: 11px; width: 100%; padding: 10px">
    <input type="email"><input type="tel"><input type="password"><input type="datetime-local">
    <textarea style="font-size: 12px"></textarea>
    <div contenteditable="plaintext-only" style="font-size: 12px"></div>
    <input type="checkbox" style="font-size: 11px; width: 13px">
  </label>`
  browser.happyDOM.setWindowSize({ width: 390, height: 844 })
  for (const control of browser.document.querySelectorAll('input:not([type="checkbox"]), textarea, [contenteditable]')) {
    assert.ok(parseFloat(browser.getComputedStyle(control).fontSize) >= 16)
  }
  const checkbox = browser.document.querySelector('[type="checkbox"]')
  assert.equal(browser.getComputedStyle(checkbox).width, '13px')
  assert.equal(browser.getComputedStyle(checkbox).fontSize, '11px')

  const input = browser.document.querySelector('[type="search"]')
  const mobile = browser.getComputedStyle(input)
  const theme = { fontFamily: mobile.fontFamily, color: mobile.color, padding: mobile.padding }
  const desktopBrowser = new Window({ width: 1280, height: 844 })
  const desktopCss = desktopBrowser.document.createElement('style')
  desktopCss.textContent = css.textContent
  desktopBrowser.document.head.append(desktopCss)
  desktopBrowser.document.body.innerHTML = browser.document.body.innerHTML
  const desktop = desktopBrowser.getComputedStyle(desktopBrowser.document.querySelector('[type="search"]'))
  assert.equal(desktop.fontSize, '11px')
  assert.deepEqual({ fontFamily: desktop.fontFamily, color: desktop.color, padding: desktop.padding }, theme)
  desktopBrowser.happyDOM.abort()
})

async function withTextGeometry(callback) {
  const prototype = browser.HTMLElement.prototype
  const descriptors = ['clientWidth', 'offsetWidth'].map(key => [key, Object.getOwnPropertyDescriptor(prototype, key)])
  const geometry = { width: 140, glyphWidth: 0.75 }
  Object.defineProperty(prototype, 'clientWidth', { configurable: true, get: () => geometry.width })
  Object.defineProperty(prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return Math.ceil(this.textContent.length * parseFloat(browser.getComputedStyle(this).fontSize) * geometry.glyphWidth)
    }
  })
  try {
    await callback(geometry)
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(prototype, key, descriptor)
      else delete prototype[key]
    }
  }
}

test('responsive titles fit whole words, respond to wider fonts, and restore their original size when space returns', async () => {
  await withTextGeometry(async geometry => {
    const container = browser.document.createElement('div')
    browser.document.body.append(container)
    root = createRoot(container)
    const renderTitle = async (text, family = 'Georgia') => {
      await act(async () => root.render(React.createElement(ResponsiveText, {
        style: { '--responsive-base-size': '30px', fontFamily: family }
      }, text)))
      return container.querySelector('h1')
    }

    let title = await renderTitle('Investments')
    const firstSize = parseFloat(browser.getComputedStyle(title).fontSize)
    assert.ok(firstSize < 30)
    assert.ok(firstSize * 'Investments'.length * geometry.glyphWidth <= geometry.width)
    assert.equal(title.textContent, 'Investments')
    assert.equal(title.querySelector('[aria-hidden]'), null)
    assert.equal(browser.getComputedStyle(title).overflowWrap, 'normal')

    geometry.glyphWidth = 1
    title = await renderTitle('Investments', 'Rye')
    assert.ok(parseFloat(browser.getComputedStyle(title).fontSize) < firstSize)
    assert.equal(browser.getComputedStyle(title).fontFamily, 'Rye')

    geometry.width = 400
    title = await renderTitle('Investments', 'Rye')
    assert.equal(browser.getComputedStyle(title).fontSize, '30px')
    geometry.width = 240
    title = await renderTitle('Long account name')
    assert.equal(browser.getComputedStyle(title).fontSize, '30px')
    assert.equal(title.textContent, 'Long account name')
  })
})

test('responsive currency text keeps every digit visible instead of overflowing its cell', async () => {
  await withTextGeometry(async geometry => {
    geometry.width = 90
    const container = browser.document.createElement('div')
    browser.document.body.append(container)
    root = createRoot(container)
    for (const value of ['$123,456.78', '-$12,345,678.90']) {
      await act(async () => root.render(React.createElement(ResponsiveText, {
        as: 'strong',
        className: 'account-summary-value'
      }, value)))
      const amount = container.querySelector('strong')
      assert.equal(amount.textContent, value)
      assert.ok(parseFloat(browser.getComputedStyle(amount).fontSize) * value.length * geometry.glyphWidth <= geometry.width)
      assert.equal(browser.getComputedStyle(amount).whiteSpace, 'nowrap')
    }
  })
})
