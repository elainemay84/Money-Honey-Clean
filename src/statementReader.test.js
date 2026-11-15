import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalStatementReader } from './statementReader.js'

function readerWith(postMessage, options = {}) {
  const controller = new AbortController()
  let terminations = 0
  const worker = { postMessage() { postMessage(worker) }, terminate() { terminations += 1 } }
  const progress = []
  const reader = createLocalStatementReader({
    assets: '/statement-assets/', signal: controller.signal, onProgress: text => progress.push(text),
    workerFactory: () => worker, ...options
  })
  return { reader, controller, worker, progress, terminations: () => terminations }
}

test('reader registers startup errors before posting an image and terminates failed workers', async () => {
  const setup = readerWith(worker => worker.onerror({ preventDefault() {} }))
  await assert.rejects(setup.reader.recognize(new ArrayBuffer(1)), /could not start/)
  assert.equal(setup.terminations(), 1)
  const language = readerWith(worker => worker.onmessage({ data: { error: true } }))
  await assert.rejects(language.reader.recognize(new ArrayBuffer(1)), /failed to initialize/)
  assert.equal(language.terminations(), 1)
})

test('silent initialization times out, rejects, and releases the host instead of waiting endlessly', async () => {
  const setup = readerWith(() => {}, { initializationTimeoutMs: 5 })
  await assert.rejects(setup.reader.recognize(new ArrayBuffer(1)), /did not initialize/)
  assert.equal(setup.terminations(), 1)
})

test('initialization and OCR can be canceled and subsequent late messages cannot apply results', async () => {
  for (const ready of [false, true]) {
    const setup = readerWith(worker => {
      if (ready) worker.onmessage({ data: { ready: true } })
    })
    const result = setup.reader.recognize(new ArrayBuffer(1))
    setup.controller.abort(new DOMException('Cancelled', 'AbortError'))
    await assert.rejects(result, { name: 'AbortError' })
    setup.worker.onmessage({ data: { lines: ['Current Balance: $999'] } })
    assert.equal(setup.terminations(), 1)
  }
})

test('initialization stages reach the UI and one reader can process more than one PDF page', async () => {
  const setup = readerWith(worker => {
    worker.onmessage({ data: { status: 'Loading English recognition data... 50%' } })
    worker.onmessage({ data: { ready: true } })
    worker.onmessage({ data: { lines: ['Current Balance: $25'] } })
  })
  assert.deepEqual(await setup.reader.recognize(new ArrayBuffer(1)), ['Current Balance: $25'])
  assert.deepEqual(await setup.reader.recognize(new ArrayBuffer(1)), ['Current Balance: $25'])
  assert.equal(setup.progress.length, 2)
  setup.reader.terminate()
  assert.equal(setup.terminations(), 1)
})
