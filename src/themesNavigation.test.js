import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const browser = new Window({ url: 'http://localhost/' })
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
const themeMeta = browser.document.createElement('meta')
themeMeta.setAttribute('name', 'theme-color')
browser.document.head.append(themeMeta)

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
const roots = []

async function renderApp() {
  const container = browser.document.createElement('div')
  browser.document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(React.createElement(App)))
  return container
}

const findButton = (container, label) =>
  [...container.querySelectorAll('button')].find(button => button.textContent.includes(label))

const findNavigationItem = (container, label) =>
  [...container.querySelectorAll('nav > div')].find(item => item.textContent.includes(label))

async function click(button) {
  await act(async () => {
    button.dispatchEvent(new browser.MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  browser.document.body.replaceChildren()
  browser.localStorage.clear()
})

after(async () => {
  await vite.close()
})

test('Themes back button returns to Settings without resetting the selected theme', async () => {
  const container = await renderApp()

  const more = findNavigationItem(container, 'More')
  assert.ok(more)
  await click(more)
  const settings = findButton(container, 'Settings')
  assert.ok(settings)
  await click(settings)
  const themes = findButton(container, 'Themes & Fonts')
  assert.ok(themes)
  await click(themes)
  const header = container.querySelector('.themes-page-header')
  assert.ok(header)
  assert.equal(header.querySelector('h1').textContent, 'Themes & Fonts')

  await click(findButton(container, 'Funky Pop'))
  assert.match(browser.document.documentElement.style.getPropertyValue('--app-background-image'), /linear-gradient/)
  assert.equal(browser.document.documentElement.style.getPropertyValue('--app-status-background'), '#F33C9A')
  assert.match(container.querySelector('.app-shell').style.getPropertyValue('--theme-page-background-image'), /linear-gradient/)
  assert.equal(browser.document.querySelector('meta[name="theme-color"]').content, '#F33C9A')

  const midnight = findButton(container, 'Midnight')
  assert.ok(midnight)
  await click(midnight)
  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-theme-settings')).themeId, 'midnight')

  const back = findButton(container, 'Settings')
  assert.ok(back)
  await click(back)

  assert.match(container.textContent, /Themes & Fonts/)
  assert.equal(JSON.parse(browser.localStorage.getItem('money-honey-theme-settings')).themeId, 'midnight')
  assert.equal(browser.document.documentElement.style.getPropertyValue('--app-background'), '#171C24')
})
