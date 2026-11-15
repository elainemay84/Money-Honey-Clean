import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveStatementFileKind } from './statementExtraction.js'
import { decodeHeicFile, HEIC_MAX_PIXELS, sniffStatementBytes } from './statementImageFormat.js'

const ftyp = (major, ...compatible) => {
  const brands = [major, '\0\0\0\0', ...compatible].join('')
  const bytes = new Uint8Array(8 + brands.length + 8)
  new DataView(bytes.buffer).setUint32(0, 8 + brands.length)
  bytes.set([...'ftyp'].map(char => char.charCodeAt(0)), 4)
  bytes.set([...brands].map(char => char.charCodeAt(0)), 8)
  return bytes
}
// Header of a real iPhone-style HEIC written by macOS sips.
const heic = ftyp('heic', 'heic', 'mif1')

test('HEIC and HEIF files are recognized from their bytes, not their name or MIME type', () => {
  assert.equal(sniffStatementBytes(heic), 'heif')
  assert.equal(sniffStatementBytes(ftyp('mif1', 'mif1', 'heix')), 'heif')
  assert.equal(sniffStatementBytes(ftyp('hevc', 'msf1')), 'heif')
  assert.equal(sniffStatementBytes(ftyp('avif', 'avif', 'mif1')), null)
  assert.equal(sniffStatementBytes(ftyp('isom', 'mp41')), null)
  assert.equal(sniffStatementBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpeg')
  assert.equal(sniffStatementBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png')
  assert.equal(sniffStatementBytes(new TextEncoder().encode('%PDF-1.7')), 'pdf')
  assert.equal(sniffStatementBytes(new TextEncoder().encode('hello')), null)
})

test('HEIC files with blank, generic or wrong MIME types still route to the image reader', async () => {
  for (const [name, type] of [['IMG_1234', ''], ['IMG_1234.HEIF', 'application/octet-stream'], ['photo.jpg', 'image/jpeg'], ['scan.txt', 'text/plain']]) {
    assert.equal(await resolveStatementFileKind(new File([heic], name, { type })), 'image')
  }
  assert.equal(await resolveStatementFileKind(new File(['%PDF-1.7'], 'download', { type: '' })), 'pdf')
  assert.equal(await resolveStatementFileKind(new File(['notes'], 'photo.png', { type: 'image/png' })), 'image')
  await assert.rejects(resolveStatementFileKind(new File(['notes'], 'notes.txt', { type: 'text/plain' })), { name: 'StatementScanError' })
  await assert.rejects(resolveStatementFileKind(new File([], 'IMG_1234.HEIC', { type: 'image/heic' })), { name: 'StatementScanError' })
})

function fakeWorker(reply) {
  const state = { created: 0, terminated: 0, messages: [] }
  const factory = () => {
    state.created += 1
    const worker = {
      terminate: () => { state.terminated += 1 },
      postMessage(message) {
        state.messages.push(message)
        queueMicrotask(() => reply(worker, message))
      }
    }
    return worker
  }
  return { state, factory }
}

const photo = () => new File([heic], 'IMG_1234.HEIC', { type: 'image/heic' })

test('HEIC conversion returns local pixels from one worker and always cleans it up', async () => {
  const { state, factory } = fakeWorker((worker, { bytes, maxPixels }) => {
    assert.ok(bytes.byteLength > 0)
    assert.equal(maxPixels, HEIC_MAX_PIXELS)
    worker.onmessage({ data: { width: 2, height: 1, data: new Uint8ClampedArray(8).fill(255).buffer } })
  })
  const result = await decodeHeicFile(photo(), { signal: new AbortController().signal, workerFactory: factory })
  assert.deepEqual([result.width, result.height, result.data.length], [2, 1, 8])
  assert.deepEqual([state.created, state.terminated], [1, 1])
})

test('unsupported, oversized, crashing or stalled HEIC conversion fails once with a JPEG/PNG fallback', async () => {
  const signal = new AbortController().signal
  for (const [reply, message] of [
    [worker => worker.onmessage({ data: { error: 'decode' } }), /JPEG or PNG/],
    [worker => worker.onmessage({ data: { error: 'too-large' } }), /too large.*JPEG or PNG/],
    [worker => worker.onerror({ preventDefault() {} }), /JPEG or PNG/],
    [worker => worker.onmessageerror(), /JPEG or PNG/]
  ]) {
    const { state, factory } = fakeWorker(reply)
    await assert.rejects(decodeHeicFile(photo(), { signal, workerFactory: factory }), { name: 'StatementScanError', message })
    assert.deepEqual([state.created, state.terminated], [1, 1])
  }
  const stalled = fakeWorker(() => {})
  await assert.rejects(decodeHeicFile(photo(), { signal, workerFactory: stalled.factory, timeoutMs: 20 }), { name: 'StatementScanError', message: /JPEG or PNG/ })
  assert.deepEqual([stalled.state.created, stalled.state.terminated], [1, 1])
})

test('cancelling HEIC conversion stops its worker without a stuck loading state', async () => {
  const controller = new AbortController()
  const { state, factory } = fakeWorker(() => controller.abort(new DOMException('Cancelled', 'AbortError')))
  await assert.rejects(decodeHeicFile(photo(), { signal: controller.signal, workerFactory: factory }), { name: 'AbortError' })
  assert.equal(state.terminated, 1)
  const aborted = new AbortController()
  aborted.abort(new DOMException('Cancelled', 'AbortError'))
  const unused = fakeWorker(() => {})
  await assert.rejects(decodeHeicFile(photo(), { signal: aborted.signal, workerFactory: unused.factory }), { name: 'AbortError' })
  assert.equal(unused.state.created, 0)
})
