import { StatementScanError } from './statementReader.js'

export const HEIC_MAX_PIXELS = 30_000_000
const HEIC_DECODE_MS = 45_000
const HEVC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'])

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end))
}

// Identifies a statement file from its first bytes, regardless of its name or reported MIME type.
export function sniffStatementBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return 'pdf'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 8 && ascii(bytes, 1, 4) === 'PNG' && bytes[0] === 0x89) return 'png'
  if (bytes.length >= 16 && ascii(bytes, 4, 8) === 'ftyp') {
    const size = Math.min(bytes.length, new DataView(bytes.buffer, bytes.byteOffset).getUint32(0) || bytes.length)
    const brands = [ascii(bytes, 8, 12)]
    for (let offset = 16; offset + 4 <= size; offset += 4) brands.push(ascii(bytes, offset, offset + 4))
    if (brands.some(brand => HEVC_BRANDS.has(brand))) return 'heif'
  }
  return null
}

export async function sniffStatementFile(file) {
  try {
    return sniffStatementBytes(await file.slice(0, 64).arrayBuffer())
  } catch {
    return null
  }
}

const heicError = () => new StatementScanError(
  'This HEIC photo could not be converted on your device. Choose a JPEG or PNG copy, or take a screenshot, and try again.'
)

// Converts HEIC/HEIF to RGBA pixels locally; one attempt per scan, never retried automatically.
export function decodeHeicFile(file, {
  signal,
  workerFactory = () => new Worker(new URL('./heicDecode.worker.js', import.meta.url), { type: 'module' }),
  timeoutMs = HEIC_DECODE_MS
}) {
  return new Promise((resolve, reject) => {
    let worker
    let timer
    const finish = (error, value) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      worker?.terminate()
      worker = undefined
      if (error) reject(error)
      else resolve(value)
    }
    const abort = () => finish(signal.reason ?? new DOMException('Reading cancelled.', 'AbortError'))
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => finish(heicError()), timeoutMs)
    file.arrayBuffer().then(bytes => {
      if (signal.aborted) return
      worker = workerFactory()
      worker.onerror = event => {
        event.preventDefault?.()
        finish(heicError())
      }
      worker.onmessageerror = () => finish(heicError())
      worker.onmessage = ({ data }) => {
        if (data.error === 'too-large') {
          finish(new StatementScanError('This HEIC photo is too large to convert on this device. Choose a smaller JPEG or PNG, or take a screenshot.'))
        } else if (data.error || !data.width || !data.height || !data.data) {
          finish(heicError())
        } else finish(null, { width: data.width, height: data.height, data: new Uint8ClampedArray(data.data) })
      }
      worker.postMessage({ bytes, maxPixels: HEIC_MAX_PIXELS }, [bytes])
    }, () => finish(heicError()))
  })
}
