import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { after, test } from 'node:test'
import { fetchLatestBuild, isUserEditing, startUpdateWatcher } from './appUpdate.js'

const windows = []
after(() => Promise.all(windows.map(win => win.happyDOM.close())))

const RUNNING = 'aaaaaaaaaaaaaaaa'
const LATEST = 'bbbbbbbbbbbbbbbb'

function setup({ body = '', latest = LATEST, storage } = {}) {
  const win = new Window({ url: 'https://money-honey.test/' })
  windows.push(win)
  const doc = win.document
  doc.head.innerHTML = `<meta name="money-honey-build" content="${RUNNING}">`
  doc.body.innerHTML = body
  const requests = []
  const state = { latest }
  const fetchImpl = async (url, options) => {
    requests.push([url, options])
    if (state.latest instanceof Error) throw state.latest
    return { ok: true, json: async () => ({ build: state.latest }) }
  }
  win.localStorage.setItem('money-honey-debts', '{"debts":[{"id":1}]}')
  const reloads = []
  const updates = []
  const sessionStore = storage ?? win.sessionStorage
  const stop = startUpdateWatcher({
    win, doc, fetchImpl, storage: sessionStore,
    reload: () => reloads.push(true), onUpdate: build => updates.push(build)
  })
  return { win, doc, requests, state, reloads, updates, stop, sessionStore }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

test('a newer deployment reloads automatically at launch when nothing is being edited, without touching saved data', async () => {
  const { win, requests, reloads, updates, stop } = setup()
  await settle()
  assert.equal(reloads.length, 1)
  assert.deepEqual(updates, [])
  assert.equal(requests[0][1].cache, 'no-store')
  assert.match(requests[0][0], /^\/version\.json\?t=\d+$/)
  assert.equal(win.localStorage.getItem('money-honey-debts'), '{"debts":[{"id":1}]}')
  stop()
})

test('an open form or dialog is never reloaded automatically; the update is offered instead', async () => {
  for (const body of ['<form><input aria-label="Amount" value="12.50"></form>', '<div role="dialog">Scanning</div>']) {
    const { reloads, updates, stop } = setup({ body })
    await settle()
    assert.deepEqual(reloads, [])
    assert.deepEqual(updates, [LATEST])
    stop()
  }
  const { doc, stop } = setup({ latest: RUNNING })
  stop()
  doc.body.innerHTML = '<input aria-label="Search">'
  doc.querySelector('input').focus()
  assert.equal(isUserEditing(doc), true)
})

test('returning to the foreground checks again and reloads once the form is closed', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
  const { win, doc, state, reloads, updates, stop } = setup({ body: '<form></form>', latest: RUNNING })
  await settle()
  assert.deepEqual([reloads.length, updates.length], [0, 0])
  state.latest = LATEST
  t.mock.timers.tick(11_000)
  doc.dispatchEvent(new win.Event('visibilitychange'))
  await settle()
  assert.deepEqual([reloads.length, updates], [0, [LATEST]])
  doc.querySelector('form').remove()
  doc.dispatchEvent(new win.Event('visibilitychange'))
  await settle()
  assert.equal(reloads.length, 0, 'repeated foreground events are throttled')
  t.mock.timers.tick(11_000)
  doc.dispatchEvent(new win.Event('visibilitychange'))
  await settle()
  assert.equal(reloads.length, 1)
  stop()
})

test('a failed reload attempt is not repeated, and offline or invalid responses change nothing', async () => {
  const first = setup()
  await settle()
  assert.equal(first.reloads.length, 1)
  first.stop()
  const again = setup({ storage: first.sessionStore })
  await settle()
  assert.deepEqual(again.reloads, [])
  assert.deepEqual(again.updates, [LATEST])
  again.stop()
  for (const latest of [new Error('offline'), RUNNING, '<script>', null]) {
    const { reloads, updates, stop } = setup({ latest })
    await settle()
    assert.deepEqual([reloads, updates], [[], []])
    stop()
  }
  assert.equal(await fetchLatestBuild(async () => ({ ok: false }), '/'), null)
})

test('development pages without a build stamp never check for updates', async () => {
  const win = new Window()
  windows.push(win)
  let fetched = false
  startUpdateWatcher({ win, doc: win.document, fetchImpl: async () => { fetched = true }, onUpdate() {} })()
  await settle()
  assert.equal(fetched, false)
})
